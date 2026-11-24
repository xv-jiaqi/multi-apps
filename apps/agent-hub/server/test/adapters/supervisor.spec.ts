/** adapter-interface.md §8.5：NodeProcessSupervisor 的场景，用真实子进程（testing.md §3）。 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FALLBACK_PATH,
  NodeProcessSupervisor,
  readLoginPath,
  type ProcessRow,
  type ProcessTable,
} from '../../src/adapters/process/supervisor';
import { AgentFailure, type AdapterLogger } from '../../src/adapters/types';

const logger: AdapterLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function memTable(): ProcessTable & { rows: Map<number, ProcessRow> } {
  const rows = new Map<number, ProcessRow>();
  return {
    rows,
    insert: (row) => void rows.set(row.pid, row),
    remove: (pid) => void rows.delete(pid),
    list: () => [...rows.values()],
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const NODE = process.execPath;
const spec = (args: string[], extra: Partial<{ taskId: string | null; label: string }> = {}) => ({
  command: NODE,
  args,
  cwd: tmpdir(),
  env: { PATH: process.env.PATH ?? '' },
  label: extra.label ?? 'test',
  taskId: extra.taskId ?? null,
});

describe('NodeProcessSupervisor', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ah-sup-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('登录 PATH', () => {
    it('AGENT_HUB_LOGIN_PATH 优先', async () => {
      expect(await readLoginPath({ AGENT_HUB_LOGIN_PATH: '/a:/b', SHELL: '/bin/sh' })).toBe(
        '/a:/b',
      );
    });

    it('从登录 shell 取 PATH', async () => {
      const home = join(dir, 'home');
      mkdirSync(home, { recursive: true });
      const shell = spawnSync('sh', ['-c', 'command -v bash']).stdout.toString().trim();
      const path = await readLoginPath({ SHELL: shell, HOME: home, PATH: '/usr/bin:/bin:/opt/x' });
      expect(path).toContain('/usr/bin');
    });

    it('登录 shell 出错时用兜底路径', async () => {
      const path = await readLoginPath({ SHELL: join(dir, 'no-such-shell'), PATH: '/p' });
      expect(path).toBe(`${FALLBACK_PATH}:/p`);
    });
  });

  describe('resolveExecutable', () => {
    let sup: NodeProcessSupervisor;
    beforeAll(() => {
      const bin = join(dir, 'bin');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'tool'), '#!/bin/sh\nexit 0\n');
      chmodSync(join(bin, 'tool'), 0o755);
      writeFileSync(join(bin, 'noexec'), 'x');
      chmodSync(join(bin, 'noexec'), 0o644);
      mkdirSync(join(bin, 'adir'), { recursive: true });
      sup = new NodeProcessSupervisor(memTable(), logger, {
        AGENT_HUB_LOGIN_PATH: `relative/bin:${bin}`,
      });
    });

    it('命令名按登录 PATH 解析；相对目录跳过', async () => {
      expect(await sup.resolveExecutable('tool')).toBe(join(dir, 'bin', 'tool'));
    });
    it('找不到、不可执行、目录 → null', async () => {
      expect(await sup.resolveExecutable('nope-xyz')).toBeNull();
      expect(await sup.resolveExecutable('noexec')).toBeNull();
      expect(await sup.resolveExecutable(join(dir, 'bin', 'adir'))).toBeNull();
    });
    it('绝对路径检查可执行；相对路径（含 /）→ null', async () => {
      expect(await sup.resolveExecutable(join(dir, 'bin', 'tool'))).toBe(join(dir, 'bin', 'tool'));
      expect(await sup.resolveExecutable(join(dir, 'bin', 'noexec'))).toBeNull();
      expect(await sup.resolveExecutable('bin/tool')).toBeNull();
    });
  });

  it('启动失败抛 AGENT_SPAWN_FAILED，不写进程表', async () => {
    const table = memTable();
    const sup = new NodeProcessSupervisor(table, logger);
    const err = await sup
      .spawn({ ...spec([]), command: join(dir, 'missing-binary') })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentFailure);
    expect((err as AgentFailure).error.code).toBe('AGENT_SPAWN_FAILED');
    expect(table.rows.size).toBe(0);
  });

  it('进程表登记 / 退出后删除；stderrTail 保留尾部', async () => {
    const table = memTable();
    const sup = new NodeProcessSupervisor(table, logger);
    const p = await sup.spawn(
      spec(['-e', 'process.stderr.write("x".repeat(5000)+"END"); process.exit(3)'], {
        taskId: 't1',
      }),
    );
    expect(table.rows.get(p.pid)).toMatchObject({ pid: p.pid, pgid: p.pid, taskId: 't1' });
    expect(await p.exited).toEqual({ code: 3, signal: null });
    expect(table.rows.size).toBe(0);
    await waitFor(() => p.stderrTail().endsWith('END'));
    expect(p.stderrTail().length).toBe(4096);
  });

  it('关闭 stdin 后正常退出，不升级信号', async () => {
    const sup = new NodeProcessSupervisor(memTable(), logger);
    const p = await sup.spawn(
      spec(['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0))']),
    );
    expect(await p.terminate({ stdinGraceMs: 3000, termGraceMs: 100 })).toEqual({
      code: 0,
      signal: null,
    });
  });

  it('忽略 SIGTERM 的进程被升级为 SIGKILL；terminate 幂等', async () => {
    const sup = new NodeProcessSupervisor(memTable(), logger);
    const p = await sup.spawn(
      spec([
        '-e',
        'process.on("SIGTERM", () => {}); process.stdin.resume(); setInterval(() => {}, 1000)',
      ]),
    );
    await new Promise((r) => setTimeout(r, 150)); // 等 SIGTERM 处理器装上
    const a = p.terminate({ stdinGraceMs: 100, termGraceMs: 200 });
    const b = p.terminate();
    expect(a).toBe(b);
    expect(await a).toEqual({ code: null, signal: 'SIGKILL' });
  });

  it('组长退出后孙进程被清理', async () => {
    const sup = new NodeProcessSupervisor(memTable(), logger);
    const p = await sup.spawn(
      spec([
        '-e',
        `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
         process.stdout.write(String(c.pid) + '\\n');
         setTimeout(() => process.exit(0), 200);`,
      ]),
    );
    const grandchild = await new Promise<number>((resolve) => {
      p.stdout.setEncoding('utf8');
      p.stdout.once('data', (d: string) => resolve(Number(d.trim())));
    });
    expect(alive(grandchild)).toBe(true);
    await p.exited;
    await waitFor(() => !alive(grandchild));
  });

  it('terminateAll 结束所有存活的子进程', async () => {
    const sup = new NodeProcessSupervisor(memTable(), logger);
    const procs = await Promise.all(
      [1, 2].map(() =>
        sup.spawn(spec(['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'])),
      ),
    );
    await sup.terminateAll({ stdinGraceMs: 100, termGraceMs: 500 });
    for (const p of procs) expect(alive(p.pid)).toBe(false);
  });

  it('残留进程清理：按进程组结束；pid 被复用（命令行对不上）时跳过', async () => {
    // 上次运行留下的进程组：detached 的 node，命令行里有 marker。
    const marker = `ah-orphan-${process.pid}`;
    const orphan = spawn(NODE, ['-e', 'setInterval(() => {}, 1000)', marker], {
      detached: true,
      stdio: 'ignore',
    });
    orphan.unref();
    const reused = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    reused.unref();
    const table = memTable();
    const now = new Date().toISOString();
    table.insert({
      pid: orphan.pid!,
      pgid: orphan.pid!,
      label: 'codex',
      command: NODE,
      taskId: null,
      startedAt: now,
    });
    // 这一行登记的命令是 codex，但这个 pid 现在跑的是 sleep：视为被复用，不能杀。
    table.insert({
      pid: reused.pid!,
      pgid: reused.pid!,
      label: 'codex',
      command: '/usr/local/bin/codex',
      taskId: null,
      startedAt: now,
    });
    // 已经不存在的进程组：直接删行。
    table.insert({
      pid: 999_999,
      pgid: 999_999,
      label: 'gone',
      command: 'x',
      taskId: null,
      startedAt: now,
    });
    const sup = new NodeProcessSupervisor(table, logger);
    try {
      expect(await sup.cleanupOrphans()).toBe(1);
      await waitFor(() => !alive(orphan.pid!));
      expect(alive(reused.pid!)).toBe(true);
      expect(table.rows.size).toBe(0);
    } finally {
      try {
        process.kill(-reused.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
      try {
        process.kill(-orphan.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  });
});
