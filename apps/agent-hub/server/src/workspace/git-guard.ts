import { chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import type { HubPaths } from '../common/paths';
import { agentEnv } from './agent-env';
import { ensureHooks } from './hooks';

/**
 * security.md §3：Agent 子进程的推送守卫。
 * pre-push hook 拦截 blockedPushHosts（含 github.com），askpass 恒失败，SSH_AUTH_SOCK 去掉，
 * GH_CONFIG_DIR 指向空目录——Agent 拿不到凭据，也推不出去。
 */
export class GitGuard {
  private loginPath = '';

  constructor(
    private readonly paths: HubPaths,
    private readonly parentEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  ensure(opts: { blockedPushHosts: readonly string[]; loginPath: string }): void {
    this.loginPath = opts.loginPath;
    mkdirSync(this.paths.guard, { recursive: true, mode: 0o700 });
    mkdirSync(this.paths.ghConfig, { recursive: true, mode: 0o700 });
    ensureHooks(this.paths.hooks, opts.blockedPushHosts, this.paths.guardLog);
    writeFileSync(this.paths.askpass, '#!/bin/sh\necho "agent-hub: 凭据已禁用" >&2\nexit 1\n', {
      mode: 0o755,
    });
    chmodSync(this.paths.askpass, 0o755);
    if (!existsSync(this.paths.guardLog)) writeFileSync(this.paths.guardLog, '', { mode: 0o600 });
  }

  agentEnv(passthrough: readonly string[] = []): Record<string, string> {
    return agentEnv({
      parent: this.parentEnv,
      loginPath: this.loginPath || this.parentEnv.PATH || '',
      passthrough,
      hooksPath: this.paths.hooks,
      askpassPath: this.paths.askpass,
      ghConfigDir: this.paths.ghConfig,
    });
  }

  /** pre-push 拦截记录的行数（轮前后对比用）。 */
  blockedCount(): number {
    try {
      return readFileSync(this.paths.guardLog, 'utf8').split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }
}
