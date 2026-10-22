import { describe, expect, it } from 'vitest';
import {
  BATCH_REFUSED,
  ConflictError,
  ownOutcome,
  RefusalError,
  refusalOf,
  rejected,
  throwRefusals,
} from './protocol.js';

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

describe('refusalOf: retryable when the server kept no verdict', () => {
  const reject = (reason: string) =>
    refusalOf({ opId: 'a', status: 'rejected', reason });

  it('a recorded rejection and a conflict are for good', () => {
    expect(reject('unknown table')).toMatchObject({ retryable: false });
    expect(
      refusalOf({ opId: 'a', status: 'conflict', currentVersion: 2 }),
    ).toEqual({ kind: 'conflict', version: 2 });
  });

  it('a rolled-back op and a batch refused whole are retryable', () => {
    expect(reject('could not be applied')).toMatchObject({ retryable: true });
    expect(reject(`${BATCH_REFUSED}400 bad`)).toMatchObject({
      retryable: true,
    });
  });

  it('a command is retryable only when every op was refused retryably', () => {
    const op = { kind: 'set', table: 'task' };
    const retry = rejected('could not be applied');
    const catchOf = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        return error as RefusalError;
      }
    };
    expect(
      catchOf(() =>
        throwRefusals([
          { op, outcome: retry },
          { op, outcome: retry },
        ]),
      )?.retryable,
    ).toBe(true);
    expect(
      catchOf(() =>
        throwRefusals([
          { op, outcome: retry },
          { op, outcome: 'applied' },
        ]),
      )?.retryable,
    ).toBe(false);
  });
});
