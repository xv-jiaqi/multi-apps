// web/src/desktop/restart-policy.ts
/** 第 n 次失败后等待 `RESTART_DELAYS_MS[n - 1]` 再重启。 */
export const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** 只数这段时间内的失败；更早的失败不再计入。 */
export const RESTART_WINDOW_MS = 5 * 60_000;

/** 侧车意外退出后的自动重启节奏（D3）：5 分钟内重启过 5 次仍失败就放弃。 */
export class RestartPolicy {
  private failures: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** 记一次失败，返回下次重启前等待的毫秒数；返回 `null` 表示放弃自动重启。 */
  nextDelay(): number | null {
    const t = this.now();
    this.failures = this.failures.filter((at) => t - at < RESTART_WINDOW_MS);
    this.failures.push(t);
    return RESTART_DELAYS_MS[this.failures.length - 1] ?? null;
  }

  reset(): void {
    this.failures = [];
  }
}
