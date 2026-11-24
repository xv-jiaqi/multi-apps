import { spawn } from 'node:child_process';

/** 侧车自己执行 git 时叠加的环境（不含 Agent 子进程的推送守卫，architecture.md §7.2）。 */
export const GIT_FIXED_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  /** 要匹配 git 的英文报错（例如 couldn't find remote ref）；不影响提交信息等内容的编码。 */
  LC_ALL: 'C',
};

/** 侧车环境里若带着这些变量，`git -C` 会被带到别的仓库。 */
const LOCATING_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
];

export interface GitOptions {
  /** 叠加在基础环境之上，优先级最高。 */
  env?: Record<string, string>;
  /** 默认 30 秒；push / fetch 传 60_000。到时对 git 的进程组发 SIGKILL。 */
  timeoutMs?: number;
  /** stdout 上限，默认 64 MB；超过时结束进程并抛 kind 为 too_large 的 GitError。 */
  maxStdoutBytes?: number;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly kind: 'exit' | 'timeout' | 'too_large' | 'spawn',
    readonly result: GitResult | null,
  ) {
    const stderr = (result?.stderr ?? '').trim().split('\n').slice(-3).join(' / ');
    super(
      kind === 'exit'
        ? `git ${args[0]} 失败（退出码 ${result?.code}）：${stderr}`
        : kind === 'timeout'
          ? `git ${args[0]} 超时`
          : kind === 'too_large'
            ? `git ${args[0]} 输出过大`
            : `无法执行 git：${stderr}`,
    );
  }
}

export interface Git {
  /** 退出码非 0 时抛 GitError（kind: 'exit'）。返回 stdout 原文。 */
  run(cwd: string, args: string[], options?: GitOptions): Promise<string>;
  /** 退出码非 0 也返回；超时、输出过大、启动失败仍抛。 */
  exec(cwd: string, args: string[], options?: GitOptions): Promise<GitResult>;
}

export function createGit(baseEnv: NodeJS.ProcessEnv): Git {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined && !LOCATING_VARS.includes(k)) env[k] = v;
  }

  const exec = (cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> =>
    new Promise((resolve, reject) => {
      const child = spawn('git', ['-C', cwd, ...args], {
        env: { ...env, ...GIT_FIXED_ENV, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let failure: 'timeout' | 'too_large' | null = null;
      const kill = (why: 'timeout' | 'too_large') => {
        failure ??= why;
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      };
      const timer = setTimeout(() => kill('timeout'), options.timeoutMs ?? 30_000);
      const limit = options.maxStdoutBytes ?? 64 * 1024 * 1024;
      child.stdout.on('data', (b: Buffer) => {
        outBytes += b.length;
        if (outBytes > limit) kill('too_large');
        else out.push(b);
      });
      child.stderr.on('data', (b: Buffer) => err.push(b));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new GitError(args, 'spawn', { code: -1, stdout: '', stderr: e.message }));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const result = {
          code: code ?? -1,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        };
        if (failure) reject(new GitError(args, failure, result));
        else resolve(result);
      });
    });

  return {
    exec,
    async run(cwd, args, options) {
      const r = await exec(cwd, args, options);
      if (r.code !== 0) throw new GitError(args, 'exit', r);
      return r.stdout;
    },
  };
}
