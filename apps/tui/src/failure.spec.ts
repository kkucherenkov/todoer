import { describe, expect, it } from 'vitest';
import { FAILURE_KINDS, type Failure } from '@todoer/client-core';
import { retryable } from './failure.js';

const of = (kind: Failure['kind'], more: Partial<Failure> = {}): Failure => ({
  kind,
  detail: 'why',
  ...more,
});

describe('retryable', () => {
  it('offers the same opId again only when no verdict was kept', () => {
    const kept = FAILURE_KINDS.filter((k) => retryable(of(k)));
    expect(kept.sort()).toEqual(
      ['signed-out', 'unavailable', 'unexpected', 'unreachable'].sort(),
    );
  });

  it('a refusal is retryable only when the server says so', () => {
    expect(retryable(of('refused', { retryable: true }))).toBe(true);
    expect(retryable(of('refused', { retryable: false }))).toBe(false);
    expect(retryable(of('refused'))).toBe(false);
  });
});
