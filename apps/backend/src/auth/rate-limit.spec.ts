import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  const MIN = 60_000;
  it('allows up to the limit, then answers the seconds until the oldest failure leaves the window', () => {
    const limiter = new RateLimiter(3, 15 * MIN);
    for (const t of [0, MIN, 2 * MIN]) limiter.fail('k', t);
    expect(limiter.retryAfter('k', 2 * MIN)).toBe(13 * 60);
    expect(limiter.retryAfter('k', 15 * MIN + 1)).toBeNull();
  });
  it('is per key, and clear forgets a key', () => {
    const limiter = new RateLimiter(1, MIN);
    limiter.fail('a', 0);
    expect(limiter.retryAfter('b', 0)).toBeNull();
    limiter.clear('a');
    expect(limiter.retryAfter('a', 0)).toBeNull();
  });
});
