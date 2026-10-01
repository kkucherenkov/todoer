import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import type { AppConfig } from '../config/app-config.js';

const prisma = new PrismaService();
const config = {
  jwtSecret: 'test-secret-at-least-32-characters-long',
} as AppConfig;
const auth = new AuthService(prisma, config);
const sessions = new SessionService(prisma, config, auth);

const t0 = new Date('2026-10-01T00:00:00Z');
const at = (s: number): Date => new Date(t0.getTime() + s * 1000);
const days = (d: number): Date => new Date(t0.getTime() + d * 86_400_000);

let U: string;

beforeEach(async () => {
  await prisma.session.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.resetCode.deleteMany({});
  await prisma.user.deleteMany({});
  U = uuidv7();
  await prisma.user.create({
    data: { id: U, email: 'u@example.com', passwordHash: 'x:y' },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SessionService', () => {
  it('starts a session whose refresh token rotates on every refresh', async () => {
    // verify() checks expiry against the wall clock, which is past t0 + 15 min.
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const first = await sessions.start(U, t0);
    const second = await sessions.refresh(first.refreshToken, at(1));
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(auth.verify(second.accessToken)).toBe(U);
  });

  // Review Focus 1, FR-002.
  it('answers a retry of the spent token within 30 s with the same pair', async () => {
    const first = await sessions.start(U, t0);
    const second = await sessions.refresh(first.refreshToken, at(1));
    const retry = await sessions.refresh(first.refreshToken, at(20));
    expect(retry.refreshToken).toBe(second.refreshToken);
  });

  // Only the immediately previous generation gets the grace.
  it('revokes the session when a token two rotations old comes back in time', async () => {
    const first = await sessions.start(U, t0);
    const second = await sessions.refresh(first.refreshToken, at(1));
    await sessions.refresh(second.refreshToken, at(2));
    await expect(sessions.refresh(first.refreshToken, at(3))).rejects.toThrow(
      'invalid token',
    );
    expect((await prisma.session.findFirstOrThrow()).revokedAt).not.toBeNull();
  });

  // FR-001.
  it('revokes the session when a spent token comes back after the window', async () => {
    const first = await sessions.start(U, t0);
    const second = await sessions.refresh(first.refreshToken, at(1));
    await expect(sessions.refresh(first.refreshToken, at(40))).rejects.toThrow(
      'invalid token',
    );
    await expect(sessions.refresh(second.refreshToken, at(41))).rejects.toThrow(
      'invalid token',
    );
  });

  // Review Focus 2.
  it('rotates once when two refreshes of the same token race', async () => {
    const first = await sessions.start(U, t0);
    const [a, b] = await Promise.all([
      sessions.refresh(first.refreshToken, at(1)),
      sessions.refresh(first.refreshToken, at(1)),
    ]);
    expect(a.refreshToken).toBe(b.refreshToken);
    expect((await prisma.session.findFirstOrThrow()).generation).toBe(1);
  });

  // FR-003.
  it('expires after 30 idle days and after one year in any case', async () => {
    const idle = await sessions.start(U, t0);
    await expect(sessions.refresh(idle.refreshToken, days(31))).rejects.toThrow(
      'invalid token',
    );
    // The expiry path revokes, it does not merely refuse.
    expect((await prisma.session.findFirstOrThrow()).revokedAt).not.toBeNull();
    let s = await sessions.start(U, t0);
    for (let d = 25; d <= 375; d += 25) {
      if (d > 365) {
        await expect(
          sessions.refresh(s.refreshToken, days(d)),
        ).rejects.toThrow();
        break;
      }
      s = await sessions.refresh(s.refreshToken, days(d));
    }
  });

  it('refuses a tampered token, an unknown session and a revoked one', async () => {
    const first = await sessions.start(U, t0);
    const [id, gen] = first.refreshToken.split('.');
    await expect(sessions.refresh(`${id}.${gen}.AAAA`, at(1))).rejects.toThrow(
      'invalid token',
    );
    await expect(sessions.refresh('nonsense', at(1))).rejects.toThrow(
      'invalid token',
    );
    // Right shape for the old regex, not a UUID: must not reach the DB.
    const malformed = `${'-'.repeat(36)}.0.AAAA`;
    await expect(sessions.refresh(malformed, at(1))).rejects.toThrow(
      'invalid token',
    );
    await expect(sessions.revoke(malformed)).resolves.toBeUndefined();
    // Spelling variants of a valid token are not the token.
    await expect(
      sessions.refresh(
        `${id?.toUpperCase()}.${gen}.${first.refreshToken.split('.')[2]}`,
        at(1),
      ),
    ).rejects.toThrow('invalid token');
    await expect(
      sessions.refresh(
        `${id}.0${gen}.${first.refreshToken.split('.')[2]}`,
        at(1),
      ),
    ).rejects.toThrow('invalid token');
    await sessions.revoke(first.refreshToken);
    await expect(sessions.refresh(first.refreshToken, at(1))).rejects.toThrow(
      'invalid token',
    );
  });

  it('reports the access expiry as 15 minutes after start', async () => {
    const first = await sessions.start(U, t0);
    expect(first.accessExpiresAt).toBe(at(15 * 60).toISOString());
  });

  // The rotation writes an absolute generation, so only its `generation`
  // condition stops a stale read from rolling the session back.
  it('never rolls the generation back on a stale read', async () => {
    const first = await sessions.start(U, t0);
    const stale = await prisma.session.findFirstOrThrow();
    const second = await sessions.refresh(first.refreshToken, at(1));
    await sessions.refresh(second.refreshToken, at(2));
    vi.spyOn(prisma.session, 'findUnique').mockResolvedValueOnce(stale);
    await expect(sessions.refresh(first.refreshToken, at(100))).rejects.toThrow(
      'invalid token',
    );
    const row = await prisma.session.findFirstOrThrow();
    expect(row.generation).toBe(2);
    expect(row.revokedAt).not.toBeNull();
  });

  it('revokeAll ends every session of the user', async () => {
    const a = await sessions.start(U, t0);
    const b = await sessions.start(U, t0);
    await sessions.revokeAll(U);
    for (const s of [a, b]) {
      await expect(sessions.refresh(s.refreshToken, at(1))).rejects.toThrow();
    }
  });
});
