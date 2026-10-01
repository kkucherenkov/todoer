import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Failures per key in a sliding window, in process memory (plan D design,
 * Q12). ponytail: a restart forgets them and several processes count apart;
 * move to the database if the instance ever runs more than one.
 */
export class RateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter(
      (t) => t > now - this.windowMs,
    );
    if (kept.length === 0) this.failures.delete(key);
    else this.failures.set(key, kept);

    // Evict expired keys from the front: stop at the first live one.
    for (const [k, times] of this.failures) {
      if ((times.at(-1) ?? 0) <= now - this.windowMs) {
        this.failures.delete(k);
      } else {
        break;
      }
    }

    return kept;
  }

  fail(key: string, now: number): void {
    const recent = this.recent(key, now);
    this.failures.delete(key);
    // Cap with only the last `limit` timestamps.
    this.failures.set(key, [...recent, now].slice(-this.limit));
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  get size(): number {
    return this.failures.size;
  }

  /** Seconds until the key may try again, or `null` if it may now. */
  retryAfter(key: string, now: number): number | null {
    const recent = this.recent(key, now);
    if (recent.length < this.limit) return null;
    const oldest = recent[recent.length - this.limit] ?? now;
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }
}

/** 429 with the seconds the filter turns into `Retry-After`. */
export class TooManyRequests extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('too many attempts — try again later', HttpStatus.TOO_MANY_REQUESTS);
  }
}
