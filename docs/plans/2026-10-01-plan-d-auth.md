# Plan D: Authentication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sessions with rotating refresh tokens, `todoer login`/`logout` with
silent refresh, owner-first registration with invitations, password reset
without SMTP, account deletion, and rate-limited login.

**Architecture:** the backend gains three tables (`Session`, `Invitation`,
`ResetCode`) and `User.isOwner`. A `SessionService` issues and rotates refresh
tokens; a refresh token is derived from (session id, generation) with an HMAC,
so the server can recompute the successor for a retry inside the grace window
without storing any token. `AuthController` grows the routes the design lists;
a small in-memory rate limiter guards login, refresh and reset. The CLI stores
its tokens in a new table of its SQLite store, refreshes them inside a store
write-lock, and retries once on 401.

**Tech Stack:** NestJS 11, Prisma 6.19, PostgreSQL 18, `node:crypto`,
`node:sqlite`, Vitest 5. No new dependencies.

**Spec:** [`docs/specs/2026-10-01-plan-d-auth-design.md`](../specs/2026-10-01-plan-d-auth-design.md)
— read all of it before Task 1. ADR 0011, ADR 0014, ADR 0015. Task spec:
[`specs/tasks/done/T-2026-10-01-auth.md`](../../specs/tasks/done/T-2026-10-01-auth.md).

## Where this plan departs from the design doc

Task 9 records them in the design doc.

1. **Refresh tokens are derived, not stored.** The design says tokens are
   stored as hashes. Instead a refresh token is
   `<sessionId>.<generation>.<mac>` with
   `mac = HMAC-SHA256(JWT_SECRET, "<sessionId>.<generation>.<salt>")` and a
   random per-session `salt`. No refresh token or token hash is stored, so it can
   recompute the exact successor a grace-window retry must receive — the
   design's "same new pair" — without keeping a plaintext token for 30 s.
   Forging one needs both the server secret and the database row.
2. **No refresh cookie yet.** ADR 0011's web cookie needs the web client to
   test against; the routes accept the refresh token in the body only, and the
   cookie transport lands with the web client.
3. **The owner's reset of another user sets the new password directly**
   (`POST /auth/users/{id}/password` with `{ password }`) and revokes that
   user's sessions; reset codes exist only for the host script.
4. **`POST /auth/password` (change) returns a fresh pair** after revoking every
   session, so the client that changed the password stays signed in.
5. **The e2e scripts share a helper** (`scripts/lib/fresh-user.sh`) that signs
   in as the owner (registering it on an empty instance), issues an invitation
   and registers a fresh user with it — owner-first registration would
   otherwise refuse their second run.

## Global Constraints

- **Lifetimes:** access token 15 min (`TOKEN_TTL_MS`, unchanged); session idle
  limit 30 days from `lastUsedAt`; absolute limit 365 days from `createdAt`;
  grace window 30 s; invitation 7 days; reset code 15 min.
- **Refresh token:** `<sessionId>.<generation>.<mac>`, mac as in departure 1,
  base64url; salt = 16 random bytes, hex.
- **Invitation tokens and reset codes:** 32 random bytes, base64url; stored as
  SHA-256 hex; compared through the hash lookup.
- **Password rule:** length ≥ 8 and at least one letter (`\p{L}`), one digit
  (`\p{N}`) and one other character; the contract's `maxLength: 256` stays.
- **Rate limits (failures in a sliding 15-minute window):** login per address
  5, login per IP 20, refresh per IP 30, reset per IP 20 → `429` with
  `Retry-After` (seconds).
- **Owner-first lock:** `pg_advisory_xact_lock(2, 0)` around "count users and
  create"; class 1 stays the per-user write lock.
- **Errors stay undistinguishable:** every auth refusal reuses the existing
  generic messages (`invalid credentials`, `invalid token`); invitation and code
  failures answer `invalid invitation` / `invalid code` without saying why.
- **CLI:** tokens in table `auth` of `todoer.db`; `TODOER_TOKEN` overrides;
  refresh when the access token expires within 60 s, and once on 401.
- **Spec first:** `openapi.yaml` before the backend; generated code in its own
  commit; `pnpm spec:validate && pnpm spec:codegen`.
- **Tests:** backend `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef`;
  CLI `pnpm --filter @todoer/cli test`.
- **Trap 6:** a generated migration's `DROP DEFAULT` on `seq` columns and
  `DROP SEQUENCE "change_seq"` are deleted before applying.
- **Commits:** Conventional Commits with a scope, body says why, **no
  `Co-Authored-By` trailer**; `pnpm format` first; never commit to `main`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **A lost refresh response.** The retry with the old token inside 30 s gets
   the same pair the first call got; after 30 s it revokes the session. Tests in
   Task 4.
2. **Two refreshes of the same token at once on the server** must rotate once
   (conditional update on `generation`), the loser falling into the grace path.
   Test in Task 4.
3. **The first two registrations race.** Exactly one owner. Test in Task 6.
4. **Two CLI processes refreshing at once** send one refresh request; the second
   reads the first's new token. Test in Task 7.
5. **Revocation reaches the CLI.** A revoked session makes the next command fail
   with a clear "run todoer login", clears the stored tokens, and keeps queued
   operations queued. Test in Task 7.

---

### Task 0: Branch and documents

- [ ] On branch `feat/auth` (created from `main`, carrying the design doc).
      Commit: `git add docs/plans/2026-10-01-plan-d-auth.md specs/tasks/active/T-2026-10-01-auth.md && git commit -m "docs: plan the authentication surface" -m "Implements plan D: sessions with rotating refresh tokens, CLI login, owner-first accounts and rate-limited login."`

---

### Task 1: The contract

Implements FR-012 (contract half) (T001).

**Files:** `packages/specs/openapi/openapi.yaml`; regenerate
`packages/specs/src/generated/`.

**Interfaces — Produces** these routes (all `security: []` unless noted
`bearerAuth`), each with `default` → Problem, and these schemas:

| Route | Request | 2xx | Other |
| --- | --- | --- | --- |
| `POST /auth/register` | `RegisterRequest { email, password, invitation? }` | `201 SessionTokens` | 403 registration closed / invalid invitation, 409, 429 |
| `POST /auth/login` | `LoginRequest` (unchanged) | `200 SessionTokens` | 401, 429 |
| `POST /auth/refresh` | `RefreshRequest { refreshToken }` | `200 SessionTokens` | 401, 429 |
| `POST /auth/logout` (bearer) | `LogoutRequest { refreshToken?, all? }` | `204` | 401 |
| `POST /auth/password` (bearer) | `PasswordChange { currentPassword, newPassword }` | `200 SessionTokens` | 400 weak, 401 |
| `POST /auth/invites` (bearer, owner) | `InviteRequest { email? }` | `201 Invitation { token, expiresAt }` | 403 not owner |
| `POST /auth/users/{id}/password` (bearer, owner) | `PasswordSet { password }` | `204` | 400, 403, 404 |
| `POST /auth/forgot` | `ForgotRequest { email }` | — | `503` mail not configured |
| `POST /auth/reset` | `ResetRequest { code, password }` | `204` | 400 weak or invalid code, 429 |
| `DELETE /auth/account` (bearer) | `AccountDelete { password }` | `204` | 401, 409 owner with users |

`SessionTokens { accessToken, accessExpiresAt (date-time), refreshToken }`
replaces `LoginResponse` for login and register (keep the `LoginResponse` name
as an alias only if codegen consumers need it; the CLI is updated in Task 7).
Request schemas are closed (`additionalProperties: false`); passwords keep
`minLength: 8, maxLength: 256`; tokens and codes `maxLength: 512`; `email`
`format: email, maxLength: 254`.

- [ ] **Step 1:** write the paths and schemas above in `openapi.yaml`, each
      route documented in one or two sentences that state the rule it enforces
      (e.g. register: "Open only while the instance has no users; the first
      account becomes the owner. Afterwards an invitation is required.").
- [ ] **Step 2:** `pnpm spec:validate && pnpm spec:codegen && pnpm --filter @todoer/specs build && pnpm -w exec turbo run typecheck`
      — the backend's controller still returns `{ accessToken }`; the
      validator's `validateResponses: true` will reject that until Task 5, so
      the walking skeleton is expected to fail between Task 1 and Task 5. Unit
      tests do not go through the validator and stay green.
- [ ] **Step 3: Commit** the yaml (`feat(specs): describe sessions, invitations and resets`), then the generated code (`chore(specs): regenerate the client for plan D`). Tick T001.

---

### Task 2: Password rule, rate limiter, `Retry-After`

Implements FR-008, FR-009 (pure parts) (T002).

**Files:** create `apps/backend/src/auth/password-policy.ts` (+ spec),
`apps/backend/src/auth/rate-limit.ts` (+ spec); modify
`apps/backend/src/http-exception.filter.ts` (+ spec).

**Interfaces — Produces:** `passwordProblem(password: string): string | null`;
`class RateLimiter { constructor(limit: number, windowMs: number); fail(key: string, now: number): void; clear(key: string): void; retryAfter(key: string, now: number): number | null }`;
`class TooManyRequests extends HttpException { constructor(retryAfterSeconds: number) }`
— the filter sets `Retry-After` from it.

- [ ] **Step 1: Tests**

`password-policy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password-policy.js';

describe('passwordProblem', () => {
  it.each(['abc123!x', 'пароль1!', 'Long passphrase 9 words!'])('accepts %j', (p) => {
    expect(passwordProblem(p)).toBeNull();
  });
  it.each([
    ['ab1!', 'at least 8 characters'],
    ['abcdefgh', 'a digit'],
    ['abcdefg1', 'a symbol'],
    ['12345678!', 'a letter'],
  ])('refuses %j (%s)', (p, why) => {
    expect(passwordProblem(p)).toContain(why);
  });
});
```

`rate-limit.spec.ts`:

```ts
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
```

Add to the filter's spec: a `TooManyRequests(120)` is rendered as status 429,
problem+json, and the response gets header `Retry-After: 120` (follow the
existing filter spec's mock-response style).

- [ ] **Step 2:** run them — FAIL (modules missing).
- [ ] **Step 3: Implement**

`password-policy.ts`:

```ts
/**
 * Why a new password is refused, or `null` (plan D design, Q14): at least 8
 * characters with a letter, a digit and a symbol. One check for register,
 * reset and change, so no path is a way around it. Existing passwords are
 * never re-checked.
 */
export function passwordProblem(password: string): string | null {
  const missing: string[] = [];
  if ([...password].length < 8) return 'a password needs at least 8 characters';
  if (!/\p{L}/u.test(password)) missing.push('a letter');
  if (!/\p{N}/u.test(password)) missing.push('a digit');
  if (!/[^\p{L}\p{N}]/u.test(password)) missing.push('a symbol');
  return missing.length === 0 ? null : `a password needs ${missing.join(', ')}`;
}
```

`rate-limit.ts`:

```ts
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
    const kept = (this.failures.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (kept.length === 0) this.failures.delete(key);
    else this.failures.set(key, kept);
    return kept;
  }

  fail(key: string, now: number): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  clear(key: string): void {
    this.failures.delete(key);
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
```

In `http-exception.filter.ts`, before sending: `if (exception instanceof TooManyRequests) response.setHeader('Retry-After', String(exception.retryAfterSeconds));`.

- [ ] **Step 4:** backend tests pass; mutations: drop the symbol check (the
      `abcdefg1` case fails); use the newest failure (`recent.at(-1)`) instead of
      `recent[recent.length - this.limit]` (the 13-minute assertion fails);
      remove the header line (the filter test fails).
- [ ] **Step 5: Commit** `feat(backend): add the password rule and a login rate limiter` — body: why (Q12, Q14). Tick T002.

---

### Task 3: Schema and migration

Implements the storage of FR-001, FR-005, FR-006 (T003).

**Files:** `apps/backend/prisma/schema.prisma`, a new migration, the three
spec files' `beforeEach` cleanups (add `session`, `invitation`, `resetCode`
before `user`).

- [ ] **Step 1: Schema** — add to `User`: `isOwner Boolean @default(false)`,
      `sessions Session[]`, `resetCodes ResetCode[]`; add:

```prisma
/// One sign-in of one device (plan D). The refresh token is derived from
/// (id, generation, salt) with JWT_SECRET, so nothing secret is stored but
/// the salt; `generation` moves on every refresh.
model Session {
  id         String    @id @db.Uuid
  userId     String    @db.Uuid
  salt       String
  generation Int       @default(0)
  rotatedAt  DateTime?
  lastUsedAt DateTime  @default(now())
  createdAt  DateTime  @default(now())
  revokedAt  DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// A single-use registration token the owner issues (ADR 0014, plan D Q7).
model Invitation {
  id        String    @id @db.Uuid
  tokenHash String    @unique
  createdBy String    @db.Uuid
  email     String?
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
}

/// A one-time password reset code, printed by the owner's host script.
model ResetCode {
  id        String    @id @db.Uuid
  userId    String    @db.Uuid
  codeHash  String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Migration** —
      `pnpm --filter @todoer/backend exec prisma migrate dev --create-only --name auth_sessions`
      against `todoer_test`; delete the trap-6 statements; append:

```sql
-- An instance created before plan D already has users. The earliest one is
-- its owner (plan D design, Q7); the operator corrects it in the database if
-- that is the wrong person.
UPDATE "User" SET "isOwner" = true
 WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt", "id" LIMIT 1);
```

  `prisma migrate deploy`, `prisma generate`; check `\d "Session"` and that the
  synced tables' `seq` defaults are untouched.
- [ ] **Step 3: Test** — add to `auth.service.spec.ts` a test that a deleted user's sessions go with it (create user + session via prisma, delete user, `session.count` is 0) — FAIL before the migration, PASS after.
- [ ] **Step 4: Commit** `feat(backend): store sessions, invitations and reset codes`. Tick T003.

---

### Task 4: The session service

Implements FR-001, FR-002, FR-003 (T004).

**Files:** create `apps/backend/src/auth/session.service.ts` (+ spec);
register it in `app.module.ts`.

**Interfaces — Produces:**

```ts
type SessionTokens = { accessToken: string; accessExpiresAt: string; refreshToken: string };
class SessionService {
  start(userId: string, now?: Date): Promise<SessionTokens>;
  refresh(refreshToken: string, now?: Date): Promise<SessionTokens>; // throws UnauthorizedException('invalid token')
  revoke(refreshToken: string): Promise<void>;                          // no-op on anything unknown
  revokeAll(userId: string): Promise<void>;
}
```

`AuthService.sign(userId)` is reused for access tokens; extend it to return
`{ token, expiresAt }` through a new `signWithExpiry(userId, now)` and keep
`sign` for existing callers.

- [ ] **Step 1: Tests** (`session.service.spec.ts`, real `todoer_test` DB,
      fixed clocks via the `now` parameter):

```ts
// setup: prisma, config { jwtSecret: 'test-secret-at-least-32-characters-long' },
// auth = new AuthService(prisma, config), sessions = new SessionService(prisma, config, auth);
// beforeEach: clean session, then user; create one user U.

it('starts a session whose refresh token rotates on every refresh', async () => {
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

// FR-001.
it('revokes the session when a spent token comes back after the window', async () => {
  const first = await sessions.start(U, t0);
  const second = await sessions.refresh(first.refreshToken, at(1));
  await expect(sessions.refresh(first.refreshToken, at(40))).rejects.toThrow('invalid token');
  await expect(sessions.refresh(second.refreshToken, at(41))).rejects.toThrow('invalid token');
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
  await expect(sessions.refresh(idle.refreshToken, days(31))).rejects.toThrow('invalid token');
  let s = await sessions.start(U, t0);
  for (let d = 25; d <= 375; d += 25) {
    if (d > 365) { await expect(sessions.refresh(s.refreshToken, days(d))).rejects.toThrow(); break; }
    s = await sessions.refresh(s.refreshToken, days(d));
  }
});

it('refuses a tampered token, an unknown session and a revoked one', async () => {
  const first = await sessions.start(U, t0);
  const [id, gen] = first.refreshToken.split('.');
  await expect(sessions.refresh(`${id}.${gen}.AAAA`, at(1))).rejects.toThrow('invalid token');
  await expect(sessions.refresh('nonsense', at(1))).rejects.toThrow('invalid token');
  await sessions.revoke(first.refreshToken);
  await expect(sessions.refresh(first.refreshToken, at(1))).rejects.toThrow('invalid token');
});

it('revokeAll ends every session of the user', async () => {
  const a = await sessions.start(U, t0);
  const b = await sessions.start(U, t0);
  await sessions.revokeAll(U);
  for (const s of [a, b]) await expect(sessions.refresh(s.refreshToken, at(1))).rejects.toThrow();
});
```

(`t0 = new Date('2026-10-01T00:00:00Z')`, `at(s)` = t0 + s seconds,
`days(d)` = t0 + d days.)

- [ ] **Step 2:** run — FAIL (module missing).
- [ ] **Step 3: Implement** `session.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const DAY_MS = 86_400_000;
export const IDLE_MS = 30 * DAY_MS;
export const ABSOLUTE_MS = 365 * DAY_MS;
export const GRACE_MS = 30_000;
const INVALID_TOKEN = 'invalid token';

export type SessionTokens = {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
};

type Parsed = { id: string; generation: number; mac: string };

function parse(token: string): Parsed | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, gen, mac] = parts;
  if (id === undefined || gen === undefined || mac === undefined) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{1,9}$/.test(gen)) return null;
  return { id, generation: Number(gen), mac };
}

/**
 * Sessions with rotating refresh tokens (plan D design, Q2, Q4, Q5). A token
 * is `<id>.<generation>.<mac>`, the mac an HMAC over the id, the generation
 * and a per-session salt (plan departure 1): nothing secret is stored, and the
 * successor of any generation can be recomputed, which is what lets a retry
 * inside the grace window receive the very pair the first call got.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {}

  private mac(id: string, generation: number, salt: string): string {
    return createHmac('sha256', this.config.jwtSecret)
      .update(`${id}.${String(generation)}.${salt}`)
      .digest('base64url');
  }

  private tokens(userId: string, id: string, generation: number, salt: string, now: Date): SessionTokens {
    const access = this.auth.signWithExpiry(userId, now);
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt.toISOString(),
      refreshToken: `${id}.${String(generation)}.${this.mac(id, generation, salt)}`,
    };
  }

  async start(userId: string, now = new Date()): Promise<SessionTokens> {
    const id = uuidv7();
    const salt = randomBytes(16).toString('hex');
    await this.prisma.session.create({ data: { id, userId, salt, lastUsedAt: now, createdAt: now } });
    return this.tokens(userId, id, 0, salt, now);
  }

  async refresh(refreshToken: string, now = new Date()): Promise<SessionTokens> {
    const invalid = new UnauthorizedException(INVALID_TOKEN);
    const parsed = parse(refreshToken);
    if (parsed === null) throw invalid;
    const session = await this.prisma.session.findUnique({ where: { id: parsed.id } });
    if (session === null || session.revokedAt !== null) throw invalid;
    const expected = Buffer.from(this.mac(session.id, parsed.generation, session.salt));
    const given = Buffer.from(parsed.mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid;
    if (
      now.getTime() - session.createdAt.getTime() > ABSOLUTE_MS ||
      now.getTime() - session.lastUsedAt.getTime() > IDLE_MS
    ) {
      await this.revokeById(session.id, now);
      throw invalid;
    }
    if (parsed.generation === session.generation) {
      // Conditional on the generation: of two concurrent refreshes, one
      // rotates and the other finds the generation moved and takes the grace
      // path below (Review Focus 2).
      const { count } = await this.prisma.session.updateMany({
        where: { id: session.id, generation: session.generation, revokedAt: null },
        data: { generation: session.generation + 1, rotatedAt: now, lastUsedAt: now },
      });
      if (count === 1) {
        return this.tokens(session.userId, session.id, session.generation + 1, session.salt, now);
      }
      return this.refresh(refreshToken, now);
    }
    if (
      parsed.generation === session.generation - 1 &&
      session.rotatedAt !== null &&
      now.getTime() - session.rotatedAt.getTime() <= GRACE_MS
    ) {
      return this.tokens(session.userId, session.id, session.generation, session.salt, now);
    }
    // A spent token outside the window: treat as stolen, end the session for
    // whoever holds either token (reuse detection).
    await this.revokeById(session.id, now);
    throw invalid;
  }

  private async revokeById(id: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
  }

  async revoke(refreshToken: string): Promise<void> {
    const parsed = parse(refreshToken);
    if (parsed !== null) await this.revokeById(parsed.id, new Date());
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
```

`revoke` must only revoke the caller's own session: Task 5 checks the session
belongs to the authenticated user before calling it. In `auth.service.ts` add:

```ts
  signWithExpiry(userId: string, now = new Date()): { token: string; expiresAt: Date } {
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
    const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expiresAt.getTime() })).toString('base64url');
    const mac = createHmac('sha256', this.config.jwtSecret).update(payload).digest('base64url');
    return { token: `${payload}.${mac}`, expiresAt };
  }
```

and make `sign(userId)` return `this.signWithExpiry(userId).token`.

- [ ] **Step 4:** backend tests pass. Mutations: drop the grace branch (the
      30 s retry test fails); drop `generation: session.generation` from the
      `updateMany` where (the race test fails or flakes — run it 5 times);
      change `IDLE_MS` comparison to `ABSOLUTE_MS` (the idle test fails).
- [ ] **Step 5: Commit** `feat(backend): rotate refresh tokens with a grace window` — body: why (Q2, Q4, departure 1). Tick T004.

---

### Task 5: Login, refresh, logout, password change

Implements FR-001, FR-004, FR-008, FR-009 at the HTTP layer (T005).

**Files:** `apps/backend/src/auth/auth.controller.ts`,
`apps/backend/src/auth/auth.service.ts`, a new
`apps/backend/src/auth/auth.controller.spec.ts`.

**Interfaces:** consumes `SessionService` (Task 4), `RateLimiter`,
`TooManyRequests`, `passwordProblem` (Task 2). Produces the routes of Task 1
for login, refresh, logout and password; `AuthService.verifyPassword(userId, password): Promise<boolean>` and `AuthService.setPassword(userId, password): Promise<void>` (scrypt, same format as `register`).

- [ ] **Step 1: Tests** — `auth.controller.spec.ts` drives the controller
      directly (construct it with real `AuthService`, `SessionService`,
      `PrismaService` against `todoer_test`; pass a fake `{ ip: '1.2.3.4' }`
      request where the route needs one):
  - login returns `{ accessToken, accessExpiresAt, refreshToken }` and the
    access token verifies;
  - refresh with that refresh token returns a new pair (scenario 1 server side);
  - after five wrong passwords for one address the sixth login throws
    `TooManyRequests` even with the right password; a different address from
    the same IP is not blocked until the IP limit (scenario 6);
  - a successful login clears the address counter;
  - logout with `{ refreshToken }` revokes that session (refresh then 401);
    logout with `{ all: true }` revokes every session of the user; logout of a
    refresh token belonging to another user does nothing;
  - password change with the wrong current password → 401; with a weak new
    password → 400 naming the rule; success → every old session revoked and a
    fresh pair returned that works.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement** — in the controller, one `RateLimiter` per rule
      (as private fields: `loginByAddress = new RateLimiter(5, 15 * 60_000)`,
      `loginByIp = new RateLimiter(20, …)`, `refreshByIp = new RateLimiter(30, …)`);
      each failing route calls `fail`, checks `retryAfter` **before** doing any
      work (throw `TooManyRequests`), and a success clears the address key. Use
      `@Req() req: { ip?: string; userId?: string }` for the IP (`req.ip ?? 'unknown'`)
      and the guarded `@CurrentUser()` for bearer routes; bearer routes use
      `@UseGuards(AuthGuard)`. `login` calls `auth.login` (which now returns the
      user id on success) then `sessions.start`. `logout` with `refreshToken`
      parses the session id, checks `session.userId === userId`, then revokes;
      `all: true` → `revokeAll(userId)`; answers 204 (`@HttpCode(204)`). Password
      change: verify current (401 `invalid credentials`), `passwordProblem`
      (400 with the reason), `setPassword`, `revokeAll`, `sessions.start` → 200.
      Change `auth.login` to return `{ userId }` and adapt its existing tests.
- [ ] **Step 4:** backend tests pass; walking skeleton not yet run (Task 9).
      Mutations: skip the `retryAfter` check before verifying the password (the
      sixth-login test fails); drop the owner check in logout-by-token (the
      other-user test fails); skip `revokeAll` in password change (the old
      session test fails).
- [ ] **Step 5: Commit** `feat(backend): sign in with sessions, refresh, log out and change passwords`. Tick T005.

---

### Task 6: Accounts — owner-first, invitations, resets, deletion, host script

Implements FR-005, FR-006, FR-007, FR-009 (T006).

**Files:** `apps/backend/src/auth/auth.controller.ts`, a new
`apps/backend/src/auth/accounts.service.ts` (+ spec),
`apps/backend/src/scripts/owner-reset-password.ts`,
`apps/backend/package.json` (script), `apps/backend/tsconfig.build.json` if the
script needs including.

**Interfaces — Produces** `AccountsService`:

```ts
register(email: string, password: string, invitation?: string): Promise<{ userId: string; owner: boolean }>;
invite(ownerId: string, email?: string, now?: Date): Promise<{ token: string; expiresAt: Date }>;
setPasswordFor(ownerId: string, targetId: string, password: string): Promise<void>;
issueResetCode(userId: string, now?: Date): Promise<string>;   // host script
reset(code: string, password: string, now?: Date): Promise<void>;
deleteAccount(userId: string, password: string): Promise<void>;
```

- [ ] **Step 1: Tests** (`accounts.service.spec.ts`, `todoer_test`):
  - first `register` on an empty instance → `owner: true`, no invitation needed;
    a second without an invitation → `ForbiddenException('registration is closed')`;
  - Review Focus 3: two `register` calls on an empty instance with
    `Promise.all` → exactly one user has `isOwner`, and the other call is
    refused;
  - `invite` by a non-owner → `ForbiddenException`; by the owner → a token;
    registering with it works once (second use → `invalid invitation`); an
    expired one (now + 8 days) → `invalid invitation`; one bound to
    `x@e.test` refuses `y@e.test`; the stored row holds only `tokenHash`, never
    the token;
  - a weak password is refused by register, `setPasswordFor`, `reset` (400 with
    the rule);
  - `setPasswordFor` by the owner revokes the target's sessions and the new
    password logs in (scenario 5); by a non-owner → 403; unknown target → 404;
  - `issueResetCode` then `reset` within 15 minutes sets the password, revokes
    all sessions, and the same code fails a second time; after 16 minutes →
    `invalid code`;
  - `deleteAccount` with the wrong password → 401; with the right one, the user
    and their tasks, projects, tags, task tags, task occurrences, applied ops,
    sessions and reset codes are gone; the owner while another user exists →
    `ConflictException`; the owner alone → deleted.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement** — `register` runs in one `$transaction` that first
      takes `pg_advisory_xact_lock(2, 0)` (`tx.$executeRaw\`SELECT pg_advisory_xact_lock(2, 0)\``),
      counts users, and either creates the owner or validates and consumes the
      invitation (`usedAt`) before creating the user; password via
      `passwordProblem` first (400). Tokens/codes: `randomBytes(32).toString('base64url')`,
      stored as `createHash('sha256').update(t).digest('hex')`. `deleteAccount`
      deletes in one transaction, children first: appliedOp, taskOccurrence,
      taskTag, task, project, tag (all `where: { userId }`), then the user
      (sessions and reset codes cascade). Controller routes per Task 1, with
      `forgot` throwing `ServiceUnavailableException('mail is not configured on this instance — ask its owner to reset your password')`
      for every input. `register` returns `sessions.start(userId)` (201).
      Host script `owner-reset-password.ts`: constructs `PrismaService`, finds
      the owner (exit 1 with a message if none), builds an `AccountsService`
      enough to call `issueResetCode`, prints
      `reset code (valid 15 minutes): <code>` and the curl to use it; add
      `"owner:reset-password": "node dist/scripts/owner-reset-password.js"` to
      `apps/backend/package.json` and make sure `tsc -p tsconfig.build.json`
      emits it.
- [ ] **Step 4:** backend tests pass. Mutations: remove the advisory lock (the
      race test fails — run it 5 times); skip `usedAt` check (second-use test
      fails); skip the owner-with-users check (deletion test fails).
- [ ] **Step 5: Commit** `feat(backend): owner-first registration, invitations, resets and account deletion`. Tick T006.

---

### Task 7: CLI token store, provider and refreshing transport

Implements FR-011 (T007).

**Files:** `apps/cli/src/store.ts` (+ spec), a new `apps/cli/src/auth.ts`
(+ spec), `apps/cli/src/transport.ts` (+ spec), `apps/cli/src/index.ts`,
`apps/cli/src/config.ts`.

**Interfaces — Produces:**

```ts
// store.ts
type StoredAuth = { accessToken: string; accessExpiresAt: string; refreshToken: string };
auth(): StoredAuth | undefined; saveAuth(a: StoredAuth): void; clearAuth(): void;
withWriteLock<T>(fn: () => Promise<T>): Promise<T>;   // BEGIN IMMEDIATE … COMMIT around an async body

// auth.ts
type AuthApi = {
  login(email: string, password: string): Promise<StoredAuth>;
  refresh(refreshToken: string): Promise<StoredAuth | 'invalid'>;
  logout(accessToken: string, body: { refreshToken?: string; all?: boolean }): Promise<void>;
};
type TokenSource = { current(): Promise<string>; renew(): Promise<string | null> };
function tokenSource(store: Store, api: AuthApi, envToken: string, now: () => Date): TokenSource;
function httpAuthApi(config: Config): AuthApi;
// transport.ts
function httpTransport(config: Config, tokens: TokenSource): Transport;   // retries once on 401 after renew()
```

- [ ] **Step 1: Tests**
  - store: `saveAuth`/`auth` round-trip; `resetReplica()` keeps the auth row;
    `clearAuth` removes it; `withWriteLock` serialises two opened stores on one
    file (the second's body starts after the first's resolves).
  - auth (`tokenSource` with a fake `AuthApi` counting calls, `:memory:` store
    or a temp file):
    - env token set → `current()` returns it, the API is never called;
    - stored access valid for 10 more minutes → returned without refresh;
    - stored access expiring in 30 s → one `refresh`, new tokens saved, new
      access returned;
    - `refresh` answers `'invalid'` → `clearAuth`, and `current()` throws
      `RefusalError` with `run todoer login` (Review Focus 5);
    - Review Focus 4: two stores on one temp file, both expiring, call
      `current()` concurrently → the fake API sees exactly one refresh, both get
      the same new access token (the second re-reads inside the lock).
  - transport: a fake fetch answering 401 then 200 → one retry with the renewed
    token; 401 twice → the second 401 is returned (the existing refusal path
    reports it); no stored auth and no env token → the request goes out without
    `authorization` and a 401 leads to the refusal message mentioning
    `todoer login`.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement**
  - store: add `CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY CHECK (id = 1), access_token TEXT NOT NULL, access_expires_at TEXT NOT NULL, refresh_token TEXT NOT NULL);`
    to `SCHEMA`; `auth()` selects the row; `saveAuth` upserts id 1; `clearAuth`
    deletes; `withWriteLock` = `exec('BEGIN IMMEDIATE')`, `await fn()`,
    `COMMIT`, rollback on error (as `transaction`, but async). `resetReplica`
    is unchanged (it never touched other tables).
  - auth.ts: `current()` → env token if non-empty; else `store.auth()`; none →
    `''`; if `accessExpiresAt - now < 60_000` → `renew()`; `renew()` →
    `store.withWriteLock(async () => { re-read; if the stored access is no longer
    expiring (someone else renewed), return it; const next = await api.refresh(rt);
    if (next === 'invalid') { store.clearAuth(); throw new RefusalError('your session has ended — run todoer login'); }
    store.saveAuth(next); return next.accessToken; })`; with an env token,
    `renew()` returns `null` (nothing to renew).
  - `httpAuthApi`: POSTs to `/auth/login`, `/auth/refresh`, `/auth/logout`
    with the configured timeout; a 401 from refresh → `'invalid'`; other
    non-2xx → `RefusalError` with the status and body.
  - transport: `authorization` header only when the token is non-empty; on a
    401 call `tokens.renew()` once and resend if it returned a token.
  - index.ts: open the store, build `tokenSource(store, httpAuthApi(config), config.token, () => new Date())`,
    pass it to `httpTransport`. The existing 401 refusal text in `sync.ts` /
    HELP gains "run todoer login" (adjust the message where `sync refused: 401`
    is built).
- [ ] **Step 4:** CLI tests pass. Mutations: skip the re-read inside the lock
      (the concurrent test sees two refreshes); drop the env-token shortcut (the
      env test calls the API); skip `clearAuth` on invalid (the revocation test
      fails).
- [ ] **Step 5: Commit** `feat(cli): keep session tokens and refresh them before they expire`. Tick T007.

---

### Task 8: `todoer login` / `logout`

Implements FR-010 (T008).

**Files:** `apps/cli/src/run.ts`, `apps/cli/src/run.spec.ts`,
`apps/cli/src/index.ts`, `apps/cli/src/usage.ts`, `apps/cli/src/usage.spec.ts`.

**Interfaces:** `Deps` gains `auth: AuthApi` and
`readPassword: () => Promise<string>`; `run` handles `login <email>` and
`logout [--all]` before the flush logic (neither command syncs).

- [ ] **Step 1: Tests** (run.spec, fake `AuthApi`):
  - `login a@b.c` reads the password through `readPassword`, calls
    `api.login`, saves the tokens (`store.auth()` matches), prints
    `signed in as a@b.c`, exits 0; a refused login → `RefusalError`;
  - `login` without an email → `UsageError`;
  - `logout` sends the stored refresh token and clears the store; `--all`
    sends `{ all: true }`; with nothing stored → exit 0, nothing sent;
  - `--json` prints `{ data: { email } … }` for login and `{ data: null … }`
    for logout, in the existing envelope shape.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement** — in `run`, `if (command === 'login') …` and
      `if (command === 'logout') …` returning early with
      `{ exit: 0, stdout, stderr }` (synced: true, outbox counts as usual). In
      `index.ts`, `readPassword` = `process.env.TODOER_PASSWORD` if set, else:
      if `process.stdin.isTTY`, write `password: ` to stderr, `setRawMode(true)`,
      read characters until Enter (handle Backspace and Ctrl-C), `setRawMode(false)`;
      otherwise read all of stdin and strip one trailing newline. HELP: add the two
      commands, `TODOER_PASSWORD`, and replace the "mint one with
      POST /auth/login" text: the CLI now signs in itself and refreshes its token;
      `TODOER_TOKEN` still overrides.
- [ ] **Step 4:** CLI tests pass; mutation: skip `clearAuth` in logout (the
      logout test fails).
- [ ] **Step 5: Commit** `feat(cli): sign in and out` — body: why (ADR 0015 callers, Q3, Q13). Tick T008.

---

### Task 9: e2e scripts, README, ADRs, domain design

Implements FR-012 (T009). Departure 5.

**Files:** create `scripts/lib/fresh-user.sh`; modify
`scripts/walking-skeleton.sh`, `scripts/outbox-e2e.sh`, `README.md`,
`docs/adr/0011-bearer-everywhere-cookie-only-for-refresh.md`,
`docs/adr/0014-owner-first-registration-and-two-path-reset.md`,
`docs/specs/2026-09-25-domain-and-sync-design.md` (§5),
`docs/specs/2026-10-01-plan-d-auth-design.md` (departures).

- [ ] **Step 1: The helper** — `scripts/lib/fresh-user.sh` (POSIX, sourced with
      `. scripts/lib/fresh-user.sh`): reads `BASE`, `OWNER_EMAIL` (default
      `owner@example.test`), `OWNER_PASSWORD` (default `correct horse 9 battery!`);
      tries `POST /auth/register` with the owner credentials (succeeds on an empty
      instance), then `POST /auth/login` with them → owner access token (fail
      loudly naming `OWNER_EMAIL`/`OWNER_PASSWORD` if both refuse); `POST
      /auth/invites` → token; registers `EMAIL` (set by the caller) with
      `PASSWORD` and the invitation; sets `TOKEN` to the new user's access token.
      Use `curl -s -w '%{http_code}'` and check statuses explicitly; parse with
      `sed` as the scripts already do. Passwords used by the scripts must satisfy
      the rule (letter, digit, symbol).
- [ ] **Step 2:** both scripts source the helper instead of their own
      register/login block. In `walking-skeleton.sh` additionally prove the CLI's
      own sign-in: `HOME="$WRITER" TODOER_PASSWORD="$PASSWORD" node apps/cli/dist/index.js login "$EMAIL"`
      then one command **without** `TODOER_TOKEN` succeeds.
- [ ] **Step 3:** run both against a live backend whose database already has an
      owner (README "Running it"; run the scripts twice in a row to prove a
      second run works), plus `sh -n` on all three files.
- [ ] **Step 4: Docs**
  - README: replace the curl token-minting instructions with `todoer login`;
    "Two things that will bite a script" — the access token now refreshes
    itself; describe `TODOER_PASSWORD`/`TODOER_TOKEN`; registration is
    owner-first with invitations; mention `owner:reset-password`.
  - ADR 0011 amendment: refresh tokens are derived per (session, generation),
    rotate on every refresh with reuse detection and a 30 s grace window; the
    cookie transport arrives with the web client.
  - ADR 0014 amendment: invitation rules (single use, 7 days, optional email,
    hashed), the owner's reset of others sets the password directly, the host
    script prints a 15-minute code, the earliest user became owner on existing
    instances.
  - Domain design §5: the route list matches the implemented routes (add
    `POST /auth/password`; note device code/token as deferred).
  - Plan D design: `## Departures in the plan` listing the five departures at
    the top of this plan.
- [ ] **Step 5: Gates and commit** — `pnpm -w exec turbo run build typecheck test && pnpm lint`;
      commit `docs: document sign-in, invitations and resets; share an owner-aware e2e helper`.
      Tick T009. Closing the task follows the final review.
