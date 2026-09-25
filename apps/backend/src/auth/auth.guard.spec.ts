import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SyncController } from '../sync/sync.controller.js';
import { SyncService } from '../sync/sync.service.js';
import { AuthGuard, currentUserFactory } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AppConfig } from '../config/app-config.js';

const prisma = new PrismaService();
const config = {
  jwtSecret: 'test-secret-at-least-32-characters-long',
} as AppConfig;
const auth = new AuthService(prisma, config);
const guard = new AuthGuard(auth);

type ThrownError = { message: string; getStatus(): number };
type GuardedRequest = { headers: Record<string, string>; userId?: string };

// A minimal double for ExecutionContext: canActivate and currentUserFactory
// only ever call context.switchToHttp().getRequest(), so that is all this
// needs to provide.
function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const validToken = auth.sign('01920000-0000-7000-8000-000000000001');

  it.each([
    ['no Authorization header', {}],
    ['a header without the Bearer prefix', { authorization: 'Basic xxxx' }],
    ['a malformed token (no dot)', { authorization: 'Bearer not-a-token' }],
    [
      'a token with an extra segment',
      { authorization: `Bearer ${validToken}.junk` },
    ],
  ])('rejects %s', (_name, headers) => {
    const request: { headers: Record<string, string>; userId?: string } = {
      headers,
    };
    expect(() => guard.canActivate(contextFor(request))).toThrow();
    expect(request.userId).toBeUndefined();
  });

  it('rejects a token signed with another secret', () => {
    const other = new AuthService(prisma, {
      jwtSecret: 'a-different-secret-32-chars-long!!',
    } as AppConfig);
    const foreign = other.sign('01920000-0000-7000-8000-000000000002');
    const request = { headers: { authorization: `Bearer ${foreign}` } };

    expect(() => guard.canActivate(contextFor(request))).toThrow();
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = auth.sign('01920000-0000-7000-8000-000000000003');
    vi.setSystemTime(60 * 60_000); // an hour later; the token's TTL is 15 minutes

    const request = { headers: { authorization: `Bearer ${token}` } };
    expect(() => guard.canActivate(contextFor(request))).toThrow();
  });

  it('accepts a lower-case "bearer" scheme (RFC 7235: the scheme is case-insensitive)', () => {
    const request: { headers: Record<string, string>; userId?: string } = {
      headers: { authorization: `bearer ${validToken}` },
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.userId).toBe('01920000-0000-7000-8000-000000000001');
  });

  it('gives every rejection the same message and status — none is distinguishable to a client', () => {
    // All six rejection paths exercised elsewhere in this file, gathered
    // here so a future change that gives any one of them a distinguishing
    // message or status turns this test red. Round 1 of this test covered
    // only three (no header, wrong prefix, malformed-no-dot) and its own
    // description overclaimed "every" — corrected here, not just worded
    // around.
    const other = new AuthService(prisma, {
      jwtSecret: 'a-different-secret-32-chars-long!!',
    } as AppConfig);
    const foreign = other.sign('01920000-0000-7000-8000-000000000099');

    vi.useFakeTimers();
    vi.setSystemTime(0);
    const expiring = auth.sign('01920000-0000-7000-8000-000000000098');
    vi.setSystemTime(60 * 60_000); // an hour later; the token's TTL is 15 minutes

    const cases: Array<Record<string, string>> = [
      {},
      { authorization: 'Basic xxxx' },
      { authorization: 'Bearer not-a-token' },
      { authorization: `Bearer ${validToken}.junk` },
      { authorization: `Bearer ${foreign}` },
      { authorization: `Bearer ${expiring}` },
    ];
    const errors = cases.map((headers) => {
      try {
        guard.canActivate(contextFor({ headers }));
        throw new Error('expected canActivate to throw');
      } catch (error) {
        return error;
      }
    });

    const [first, ...rest] = errors as [ThrownError, ...ThrownError[]];
    for (const error of rest) {
      expect(error.message).toBe(first.message);
      expect(error.getStatus()).toBe(first.getStatus());
    }
  });

  it('is applied to SyncController — a refactor that drops @UseGuards would leave /sync open', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SyncController) as
      unknown[] | undefined;
    // Not expect(guards).toContain(AuthGuard): chai's toContain, given a
    // non-string needle against an undefined haystack, does not fail —
    // verified by hand, the exact silent-pass this test exists to prevent.
    // Array.isArray + includes has no such ambiguity.
    expect(Array.isArray(guards) && guards.includes(AuthGuard)).toBe(true);
  });

  it('sets request.userId independently per call — one guard instance serves every request', () => {
    const requestA: GuardedRequest = {
      headers: { authorization: `Bearer ${auth.sign('AAAA')}` },
    };
    const requestB: GuardedRequest = {
      headers: { authorization: `Bearer ${auth.sign('BBBB')}` },
    };

    guard.canActivate(contextFor(requestA));
    guard.canActivate(contextFor(requestB));

    expect(requestA.userId).toBe('AAAA');
    expect(requestB.userId).toBe('BBBB');
  });
});

describe('currentUserFactory', () => {
  it("returns the request's authenticated userId", () => {
    const context = contextFor({ userId: 'user-a' });
    expect(currentUserFactory(undefined, context)).toBe('user-a');
  });

  it('throws if the guard never ran (no userId on the request)', () => {
    expect(() => currentUserFactory(undefined, contextFor({}))).toThrow();
  });
});

describe('tenant isolation: guard + controller together', () => {
  it("a token for user A cannot cause SyncService.sync to be called with user B's id", async () => {
    const sync = vi
      .fn()
      .mockResolvedValue({ cursor: 0, results: [], changes: [] });
    const controller = new SyncController({ sync } as unknown as SyncService);
    const tokenA = auth.sign('user-A');
    const tokenB = auth.sign('user-B');
    const requestA = { headers: { authorization: `Bearer ${tokenA}` } };
    const requestB = { headers: { authorization: `Bearer ${tokenB}` } };

    guard.canActivate(contextFor(requestA));
    guard.canActivate(contextFor(requestB));

    const body = { since: 0, ops: [] as never[] };
    await controller.sync(
      currentUserFactory(undefined, contextFor(requestA)),
      body,
    );
    await controller.sync(
      currentUserFactory(undefined, contextFor(requestB)),
      body,
    );

    expect(sync).toHaveBeenNthCalledWith(1, 'user-A', body);
    expect(sync).toHaveBeenNthCalledWith(2, 'user-B', body);
  });
});
