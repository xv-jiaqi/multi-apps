// server/src/auth/rate-limit.ts
/** 每个桥接 token 一个令牌桶：平均每秒 ratePerSec 个请求，允许突发 burst 个。 */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly ratePerSec = 50,
    private readonly burst = 100,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    bucket.tokens = Math.min(
      this.burst,
      bucket.tokens + ((t - bucket.at) / 1000) * this.ratePerSec,
    );
    bucket.at = t;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
