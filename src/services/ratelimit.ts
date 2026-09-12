/**
 * Per-route token-bucket rate limiting.
 *
 * The platform App applies one global per-IP limit; the expensive endpoints here need their own,
 * stricter budgets (the live brief fires every ~1.5 s while listening, and a scribe token costs
 * ElevenLabs quota). Small, allocation-free and testable.
 */
export interface RateLimitResult {
  ok: boolean;
  /** Seconds to wait before retrying (only when !ok). */
  retryAfter: number;
}

export class RateLimiter {
  readonly rps: number;
  readonly burst: number;
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  private readonly max: number;

  constructor(rps: number, burst: number, opts: { maxKeys?: number } = {}) {
    this.rps = rps;
    this.burst = Math.max(1, burst);
    this.max = opts.maxKeys ?? 5000;
  }

  /** Take one token for `key`. */
  take(key: string, now = Date.now()): RateLimitResult {
    if (this.rps <= 0) return { ok: true, retryAfter: 0 };
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, ts: now };
      this.buckets.set(key, b);
      if (this.buckets.size > this.max) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
    }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.ts) / 1000) * this.rps);
    b.ts = now;
    if (b.tokens < 1) return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / this.rps) };
    b.tokens -= 1;
    return { ok: true, retryAfter: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }
}
