import { execFile, spawn as spawnChild } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import {
  AgentFailure,
  agentError,
  type AdapterLogger,
  type ExitInfo,
  type ManagedProcess,
  type ProcessSupervisor,
  type SpawnSpec,
  type TerminateOptions,
} from '../types';

/** processes 表的一行（data-model.md §3.3）。 */
export interface ProcessRow {
  pid: number;
  pgid: number;
  label: string;
  command: string;
  taskId: string | null;
  startedAt: string;
}

/** processes.repo.ts 绑定 Db 后的三个函数。 */
export interface ProcessTable {
  insert(row: ProcessRow): void;
  remove(pid: number): void;
  list(): ProcessRow[];
}

export const FALLBACK_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/** 停机时用更短的宽限期：侧车要在 Rust 壳的 10 秒内退出（architecture.md §10.3）。 */
export const SHUTDOWN_TERMINATE: TerminateOptions = { stdinGraceMs: 1000, termGraceMs: 1500 };

const STDERR_TAIL_CHARS = 4096;

export class NodeProcessSupervisor implements ProcessSupervisor {
  private readonly live = new Map<number, ManagedProcess>();
  private loginPathPromise: Promise<string> | null = null;

  constructor(
    private readonly table: ProcessTable,
    private readonly logger: AdapterLogger,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly now: () => Date = () => new Date(),
  ) {}

  loginPath(): Promise<string> {
    this.loginPathPromise ??= readLoginPath(this.env);
    return this.loginPathPromise;
  }

  async resolveExecutable(command: string): Promise<string | null> {
    if (command.includes('/')) {
      const path = command.startsWith('~/') ? join(homedir(), command.slice(2)) : command;
      return isAbsolute(path) && (await isExecutableFile(path)) ? path : null;
    }
    for (const dir of (await this.loginPath()).split(delimiter)) {
      if (!isAbsolute(dir)) continue;
      const candidate = join(dir, command);
      if (await isExecutableFile(candidate)) return candidate;
    }
    return null;
  }

  async spawn(spec: SpawnSpec): Promise<ManagedProcess> {
    const child = spawnChild(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } catch (err) {
      throw new AgentFailure(
        agentError(
          'AGENT_SPAWN_FAILED',
          `无法启动 ${spec.label}：${(err as Error).message}`,
          false,
        ),
      );
    }
    const pid = child.pid!;
    child.on('error', (err) =>
      this.logger.warn('子进程错误', { label: spec.label, pid, err: err.message }),
    );
    child.stdin.on('error', () => undefined);

    let stderrTail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
      this.logger.debug('子进程 stderr', { label: spec.label, pid, text: chunk.slice(0, 2048) });
    });

    this.table.insert({
      pid,
      pgid: pid,
      label: spec.label,
      command: spec.command,
      taskId: spec.taskId,
      startedAt: this.now().toISOString(),
    });

    let hasExited = false;
    const exited = new Promise<ExitInfo>((resolve) => {
      // 用 'exit' 而不是 'close'：孙进程继承了管道时 'close' 可能永远不来。
      child.once('exit', (code, signal) => {
        hasExited = true;
        this.live.delete(pid);
        this.table.remove(pid);
        killGroup(pid, 'SIGTERM', this.logger);
        this.logger.info('子进程退出', { label: spec.label, pid, code, signal });
        resolve({ code, signal });
      });
    });

    let terminating: Promise<ExitInfo> | null = null;
    const managed: ManagedProcess = {
      pid,
      label: spec.label,
      stdin: child.stdin,
      stdout: child.stdout,
      exited,
      stderrTail: () => stderrTail,
      terminate: ({ stdinGraceMs = 3000, termGraceMs = 2000 }: TerminateOptions = {}) => {
        terminating ??= (async () => {
          if (!hasExited) {
            child.stdin.end();
            if (!(await settlesWithin(exited, stdinGraceMs))) {
              killGroup(pid, 'SIGTERM', this.logger);
              if (!(await settlesWithin(exited, termGraceMs)))
                killGroup(pid, 'SIGKILL', this.logger);
            }
          }
          const info = await exited;
          killGroup(pid, 'SIGKILL', this.logger);
          return info;
        })();
        return terminating;
      },
    };
    this.live.set(pid, managed);
    return managed;
  }

  async cleanupOrphans(): Promise<number> {
    const rows = this.table.list();
    if (rows.length === 0) return 0;
    let cleaned = 0;
    const snapshot = await listProcesses();
    for (const row of rows) {
      this.table.remove(row.pid);
      const members = snapshot.filter((p) => p.pgid === row.pgid);
      if (members.length === 0) continue;
      const leader = members.find((p) => p.pid === row.pgid);
      // 组长还在但命令行对不上：pid 已被别的程序复用，这个组不是我们的。
      if (leader && !leader.command.includes(row.command)) continue;
      killGroup(row.pgid, 'SIGTERM', this.logger);
      if (!(await groupGoneWithin(row.pgid, 2000))) killGroup(row.pgid, 'SIGKILL', this.logger);
      this.logger.warn('清理了上次残留的进程组', { label: row.label, pgid: row.pgid });
      cleaned++;
    }
    return cleaned;
  }

  async terminateAll(options?: TerminateOptions): Promise<void> {
    await Promise.all([...this.live.values()].map((p) => p.terminate(options)));
  }
}

/** AGENT_HUB_LOGIN_PATH（Tauri 壳传入）→ 问登录 shell → 兜底路径。 */
export async function readLoginPath(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.AGENT_HUB_LOGIN_PATH) return env.AGENT_HUB_LOGIN_PATH;
  const shell = env.SHELL && isAbsolute(env.SHELL) ? env.SHELL : '/bin/zsh';
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        shell,
        ['-ilc', 'printf "__AH__%s__AH__" "$PATH"'],
        { timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8', env: { ...env, TERM: 'dumb' } },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
    const match = /__AH__(.+?)__AH__/s.exec(out);
    if (match?.[1]) return match[1];
  } catch {
    // 登录 shell 出错或超时：用兜底路径
  }
  return [FALLBACK_PATH, env.PATH].filter(Boolean).join(delimiter);
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function killGroup(pgid: number, signal: NodeJS.Signals, logger: AdapterLogger): void {
  try {
    process.kill(-pgid, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') logger.warn('结束进程组失败', { pgid, signal, code });
  }
}

function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

interface PsEntry {
  pid: number;
  pgid: number;
  command: string;
}

function listProcesses(): Promise<PsEntry[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=,pgid=,command='],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const entries: PsEntry[] = [];
        for (const line of stdout.split('\n')) {
          const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          if (match)
            entries.push({ pid: Number(match[1]), pgid: Number(match[2]), command: match[3]! });
        }
        resolve(entries);
      },
    );
  });
}

async function groupGoneWithin(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await listProcesses()).some((p) => p.pgid === pgid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
