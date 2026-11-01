/**
 * One wave of single mark-read requests. The page still owns the cached list;
 * this only decides when to snapshot, revert one row, or refetch.
 */
export class MarkReadBatch<Snapshot> {
  private readonly inflight = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly succeeded = new Set<string>();
  private snap: Snapshot | null = null;

  /** Remember `snap` only when this click starts a new wave. */
  begin(id: string, snap: Snapshot): void {
    if (this.inflight.size === 0 && this.failed.size === 0) {
      this.succeeded.clear();
      this.snap = snap;
    }
    this.inflight.add(id);
  }

  /**
   * `ignore` — a newer mark-all owns the cache.
   * `revert` — undo only this row; another mark is still running.
   * `wait` — this mark succeeded and another is still running.
   * `idle` — every mark in the wave succeeded.
   * `refetch` — the wave has failures and nothing is still running.
   */
  settle(
    id: string,
    failed: boolean,
    epochStale: boolean,
  ): 'ignore' | 'revert' | 'wait' | 'idle' | 'refetch' {
    this.inflight.delete(id);
    if (epochStale) return 'ignore';
    if (failed) this.failed.add(id);
    else this.succeeded.add(id);
    if (this.inflight.size > 0) return failed ? 'revert' : 'wait';
    if (this.failed.size === 0) {
      this.succeeded.clear();
      this.snap = null;
      return 'idle';
    }
    return 'refetch';
  }

  snapshot(): Snapshot | null {
    return this.snap;
  }

  paintIds(): { succeeded: ReadonlySet<string>; inflight: ReadonlySet<string> } {
    return { succeeded: this.succeeded, inflight: this.inflight };
  }

  /** After a refetch attempt, drop the wave when nothing is still running. */
  finish(): void {
    if (this.inflight.size > 0) return;
    this.failed.clear();
    this.succeeded.clear();
    this.snap = null;
  }

  clear(): void {
    this.inflight.clear();
    this.failed.clear();
    this.succeeded.clear();
    this.snap = null;
  }
}
