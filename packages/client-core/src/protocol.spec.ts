import { describe, expect, it } from 'vitest';
import { ConflictError, ownOutcome, RefusalError } from './protocol.js';

describe('ownOutcome', () => {
  it('is settled when the server applied, deduplicated or superseded it', () => {
    for (const status of ['applied', 'duplicate', 'superseded'] as const) {
      expect(ownOutcome([{ opId: 'a', status }], 'a')).toBe('settled');
    }
  });

  it('is unreported when the response does not mention it', () => {
    expect(ownOutcome([{ opId: 'b', status: 'applied' }], 'a')).toBe(
      'unreported',
    );
  });

  it('throws a RefusalError carrying the reason for a rejection', () => {
    expect(() =>
      ownOutcome(
        [{ opId: 'a', status: 'rejected', reason: 'unknown field: x' }],
        'a',
      ),
    ).toThrow(/unknown field: x/);
    expect(() => ownOutcome([{ opId: 'a', status: 'rejected' }], 'a')).toThrow(
      RefusalError,
    );
  });

  it('throws a ConflictError naming the current version', () => {
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'conflict', currentVersion: 7 }], 'a'),
    ).toThrow(ConflictError);
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'conflict', currentVersion: 7 }], 'a'),
    ).toThrow(/7/);
  });
});
