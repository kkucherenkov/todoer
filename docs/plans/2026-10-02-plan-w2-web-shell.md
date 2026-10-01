# Plan W2: the web client shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a person opens the instance in a browser, signs in, and sees their
replica sync. No feature screens yet; those are W3. This plan builds
everything a screen will stand on. The parts are a Nuxt 4 SPA in `apps/web`
(Nuxt UI with its default theme, Russian and English, a service worker with
an "update available" prompt) and a leader tab chosen by a Web Lock. The
leader owns a dedicated worker that runs `@todoer/client-core` over SQLite
WASM on OPFS (`opfs-sahpool`). Every tab, the leader's own included, reaches
that worker over one `BroadcastChannel` protocol: commands in, published
topics out. The session follows ADR 0011. The refresh token lives in the
`HttpOnly` cookie, and the access token lives only in the worker's memory.
The one screen W2 adds is a placeholder that shows how many tasks the replica
holds, so a CLI write that appears there proves the whole loop.

**Architecture:** client-core gains two portable pieces, both tested in Node.
First, a cookie-mode session: `httpCookieAuthApi` (login with
`transport: 'cookie'`, refresh with `{}`, logout with `{}`) and
`cookieTokenSource`, which holds the access token in memory and refreshes it
single-flight. Second, a `./sqlite-wasm` entry: `WasmSqlite`, the
`SqlDatabase` adapter over oo1. Node runs the WASM build in memory, so the
adapter's tests need no browser. `apps/web/app/db/` holds the shell's core. It
has five files: `protocol.ts` (types only), `engine.ts` (sessions, sync
cadence and topics over a `Store`; pure enough for Vitest), `worker.ts` (glue
that opens OPFS, builds the engine and binds the channel), `leader.ts` (the
Web Lock, spawning and restarting the worker) and `client.ts` (the tab side:
pending requests, topic refs, a build check). The UI is one page that
switches on the session topic.

**Tech Stack:** Nuxt 4.5 (`ssr: false`, `nuxt generate`, Vite 8), Nuxt UI 4.11
(Tailwind 4.3), `@nuxtjs/i18n` 10.6, `@vite-pwa/nuxt` 1.1 (vite-plugin-pwa
1.3, Workbox 7), `@sqlite.org/sqlite-wasm` 3.53.4-build1 (`opfs-sahpool`),
`@playwright/test` 1.63, Vitest 5, Web Locks, `BroadcastChannel`, dedicated
module workers.

**Spec:** [`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md):
Q2, Q3, Q9, Q10, Q11, Q12, Q13, Q14, Q16 (W2), Q19, Q20, the visual design
note, "Departures in plan W0" and "Departures in plan W1" with its W2 notes.
[ADR 0011](../adr/0011-bearer-everywhere-cookie-only-for-refresh.md) and its
W1 amendment. Task spec:
[`specs/tasks/active/T-2026-10-02-web-shell.md`](../../specs/tasks/active/T-2026-10-02-web-shell.md).

## Decisions this plan takes as given

The design and the controller settled these. They are constraints here.

1. **Nuxt 4, SPA, Nuxt UI default theme, `@vite-pwa/nuxt`, `@nuxtjs/i18n`
   (RU + EN)** (Q2, Q19, visual design note). Theme changes go through
   tokens only.
2. **Leader tab by Web Lock, followers over `BroadcastChannel`** (Q10). The
   whole core runs in the leader's dedicated worker (Q13), on
   `@sqlite.org/sqlite-wasm` with `opfs-sahpool` (Q12).
3. **The adapter is client-core's `./sqlite-wasm` entry**, a sibling of
   `./node-sqlite` (W0 departure 1). It passes `bind` only when the params
   are non-empty (W0 note). `inTransaction` reads
   `sqlite3_get_autocommit`. `withWriteLock` is `BEGIN IMMEDIATE` behind an
   in-worker queue (W0 departure 3).
4. **Cookie transport** (ADR 0011, W1 notes): sign in with
   `transport: 'cookie'`, refresh with `{}`, never read or store
   `refreshToken`, and refresh before logout when the access token has
   expired.
5. **Sync cadence** (Q14): at start, after every write, every 30 s while a
   tab is visible, on regained focus, and on `online`.
6. **The CSP is the backend's** (W1 notes). Keep `buildAssetsDir` at
   `/_nuxt/`. No inline handlers, no `eval`, no runtime inline scripts.
   Bundle icons and fonts. SQLite WASM and the worker come from the same
   origin. Playwright fails on any `securitypolicyviolation` and runs
   against the built SPA served by the backend with `WEB_ROOT`.
7. **Controller defaults (2026-10-02):** development runs over
   `http://localhost`, which Chromium and Firefox treat as a secure context.
   Playwright runs Chromium in CI, and Firefox too if it costs little.
   WebKit/Safari is a documented risk and is not in CI. The design approves
   these dependencies: `nuxt`, `@nuxt/ui`, `@vite-pwa/nuxt`, `@nuxtjs/i18n`,
   `@sqlite.org/sqlite-wasm`, `@playwright/test`. Anything else is an open
   question.
8. **The four required gate names do not change.** The new job is a
   candidate gate.

## Pinned versions (registry, 2026-10-02)

| Package | Range | Why this one |
| --- | --- | --- |
| `nuxt` | `^4.5.2` | current 4.x; builds on Vite 8 (`@nuxt/vite-builder` 4.5.2 → `vite ^8.2.0`); engines `^22.19 \|\| ^24.11`, inside the root's `>=24.15` |
| `@nuxt/ui` | `^4.11.3` | current; brings `@nuxt/icon` 2.5, `@nuxt/fonts` 0.14, `@nuxtjs/color-mode` 4 and `@tailwindcss/vite` 4.3 |
| `tailwindcss` | `^4.3.3` | a **peer** of `@nuxt/ui` (`^4`). It must be a direct dependency, because `main.css` imports it and pnpm does not hoist peers. It is the "Tailwind v4" Q2 names, so it adds nothing beyond the design |
| `@nuxtjs/i18n` | `^10.6.0` | current; `vue-i18n` 11, `@nuxt/kit ^4.5.1` |
| `@vite-pwa/nuxt` | `^1.1.1` | current; resolves `vite-plugin-pwa` 1.3.0, whose `vite` peer includes `^8.0.0` |
| `@sqlite.org/sqlite-wasm` | `3.53.4-build1` (exact) | current. It has a `node` export condition (in-memory only), so the adapter is tested in Node. The VFS and the file format are data the user keeps, so upgrades are deliberate, not a caret drift |
| `@playwright/test` | `1.63.0` (exact) | current. The browser binaries are tied to the version, and the CI cache key uses it |

Two dev dependencies are **not** on the approved list but look necessary.
They are open questions 1 and 2. Tasks 3 and 4 name a fallback for each.

| Package | Range | For |
| --- | --- | --- |
| `vue-tsc` | `^3.3.11` | `nuxt typecheck`. Without it, `.vue` files are not typechecked at all, and `nuxi` tries to `npx` it at run time, which CI must not do |
| `@iconify-json/lucide` | `^1.2.138` | the icon data Nuxt UI's default icons (`i-lucide-*`) need for `@nuxt/icon`'s client bundle. `@nuxt/icon` itself brings only `@iconify/collections`, the index of sets, not their icons |

## Verified facts (2026-10-02, on `80204ce`)

- `SqlDatabase` has six members: `exec`, `run`, `all`, `inTransaction`,
  `withWriteLock` and `close` (`packages/client-core/src/store.ts`).
  `Store.transaction` is synchronous and runs `BEGIN IMMEDIATE` on the same
  connection. With one connection, a `Store.transaction` started while a
  `withWriteLock` body is awaiting fails with "cannot start a transaction
  within a transaction". I checked this on 3.53.4 in Node. In client-core
  only `tokenSource.renew` calls `withWriteLock`, and the cookie source
  below never does. So the web never holds a transaction across an await.
- In `@sqlite.org/sqlite-wasm` 3.53.4 under Node (`dist/node.mjs`, in
  memory), `db.exec({ sql, bind: [] })` succeeds on statements with and
  without parameters. A statement with `?` and **no** `bind` binds NULL
  silently. `rowMode: 'object'` returns rows with a null prototype, and an
  INTEGER comes back as a JS `number`. `capi.sqlite3_get_autocommit(db.pointer)`
  is `1` outside a transaction and `0` inside one. The empty-`bind` guard
  therefore changes nothing observable on this version. It stays because the
  design asks for it and older oo1 builds rejected `bind: []`. Expect no
  mutation to catch it.
- `installOpfsSAHPoolVfs({ name, directory, initialCapacity, clearOnInit })`
  resolves to a `SAHPoolUtil` that has `OpfsSAHPoolDb`, `pauseVfs()` and
  `unpauseVfs()`. It does not exist in the Node build. Only one instance can
  hold a pool directory at a time, which is the exclusivity the leader
  relies on. `opfs-sahpool` does not support WAL, so the web store keeps the
  default rollback journal. A tab killed mid-transaction leaves a hot
  journal, and the next open rolls it back.
- The package locates `sqlite3.wasm` with `new URL('sqlite3.wasm',
  import.meta.url)`. Vite rewrites that into a hashed asset under
  `buildAssetsDir` when the package is excluded from `optimizeDeps`. The
  file is 869 kB.
- The backend's CSP (`apps/backend/src/web/spa.ts`) is `default-src 'self'`,
  `script-src 'self' 'wasm-unsafe-eval' <hashes>`,
  `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`. It has no
  `worker-src`, so workers and the service worker fall back to `script-src`,
  and no blob: workers are allowed. Every static file carries the policy, and
  workers take theirs from their own script's response. `sw.js` and the
  manifest get `no-cache`, and `/_nuxt/*` gets `immutable`.
- Fetch's default `credentials` is `same-origin`, in workers too. The cookie
  (`Path=/api/v1/auth`) therefore rides on the worker's auth requests
  without a flag. The adapter sets it anyway, so the intent is in the code.
- The backend counts **every 401 refresh** toward a per-IP limit of 30 per
  15 minutes, and every login attempt toward 20 per 15 minutes
  (`auth.controller.ts`). If a signed-out tab tried a cookie refresh on every
  load, it would spend that budget, and the e2e suite would hit 429 (see
  departure 4).
- `adoptAccount` and `subject` live in `apps/cli/src/run.ts` (W0 departure
  5). `subject` decodes the access token's first segment with `Buffer`. The
  backend's token is `<payload>.<signature>`. The web needs the same rule: a
  sign-in as another account must reset the replica, and must refuse while
  the outbox holds the previous account's operations.
- There is no Dockerfile. `docker/compose.yml` runs Postgres only.
- `pnpm` is 9.12, without catalogs. Turbo filters task environments (trap
  2). The Workspace tests job runs `turbo run build typecheck test` across
  every package. Once `apps/web` has those scripts, the job runs them too.

## Where this plan departs from the design doc and the brief

Task 8 records these in the design doc ("Departures in plan W2").

1. **`subject` and `adoptAccount` move from the CLI into client-core.** W0
   kept them in `run.ts` because `subject` used `Buffer`, and because the
   web's sign-in is a different flow. The flow differs, but the account rule
   does not, and a second copy in the web would be a second implementation
   of a data-loss guard. In client-core, `subject` decodes base64url with
   `atob`. The CLI imports both, and `run.spec`'s "switching accounts in one
   store" tests are the proof that nothing changed.
2. **The web's token source is a sibling, not a mode of `tokenSource`.**
   `tokenSource` is built around a stored refresh token renewed under the
   store's write lock, so that parallel processes spend it once. The cookie
   session has no stored token and one worker per origin. A flag on
   `tokenSource` would leave two different algorithms behind one name.
   `cookieTokenSource` shares `RENEW_WITHIN_MS` and the retry-once rule, and
   `StoredAuth` becomes `AccessGrant & { refreshToken }`.
3. **ESLint lints `apps/web`'s `.ts` without type information. `.vue` files
   are formatted by Prettier and typechecked by `vue-tsc`, but not linted.**
   Type-aware lint needs Nuxt's generated project references, and linting
   `.vue` needs `eslint-plugin-vue`, a dependency nobody approved. The
   typecheck gate already covers types.
4. **A signed-out tab does not try a cookie refresh.** The tab keeps a
   one-bit hint in `localStorage` (`todoer.session`). It is set when the
   session topic says signed-in, and cleared when it says signed-out. The
   leader passes the hint to the worker at spawn, and the worker tries the
   cookie only when it is set. Every 401 refresh counts toward the server's
   per-IP limit (Verified facts), and the cookie is `HttpOnly`, so nothing
   else can tell a tab whether one exists. With the hint lost (storage
   cleared), the person signs in again, and the orphaned session idles out
   in 30 days.
5. **Fonts: the system stack, not Public Sans.** `ui: { fonts: false }`
   switches off `@nuxt/fonts`, which would otherwise download a Google font
   at build time. That would make every CI and image build depend on the
   network, and it serves the files from `/_fonts/`, outside the immutable
   cache. The visual design note allows font changes through tokens. This is
   open question 3, and the default stands unless the maintainer prefers
   Public Sans.
6. **No production image in W2.** Q9 has the image build the SPA. No
   Dockerfile exists yet. Building one takes a multi-stage Dockerfile with
   `pnpm deploy`, `prisma migrate deploy` on start, a health check, a
   compose service and an e2e run against the image. That is a task of its
   own, not an appendix to this plan. It is deferred to a follow-up task
   before W3 ships (tuxedo item at Task 8).
7. **Core error messages keep their CLI wording, and the UI does not show
   them as copy.** W0 departure 6 left the rewording to W2. The worker maps
   errors to a `Failure.kind`, and the UI shows an i18n string per kind.
   The core's message appears only as a detail line. Rewording the core
   would change CLI output for no reader of the web.
8. **Firefox runs in CI only if it passes as-is. WebKit does not run**
   (controller default). Safari's handling of `Secure` cookies on
   `http://localhost` and its OPFS quirks stay a documented risk in the
   README.

## Global Constraints

- **The CLI does not change behaviour.** The only edit in `apps/cli` is
  `run.ts` importing `adoptAccount` from client-core and dropping its own
  copy and `subject` (departure 1). `git diff main -- scripts/` is empty,
  and both e2e scripts pass.
- **Dependencies:** the approved six, plus `tailwindcss` (Nuxt UI's peer).
  `vue-tsc` and `@iconify-json/lucide` go in only after the maintainer
  answers open questions 1 and 2. Until then, Task 3 uses the fallbacks
  named there. Nothing else.
- **The portable client-core entry stays portable.** `index.ts` does not
  export `./sqlite-wasm`. `sqlite-wasm.ts` imports from
  `@sqlite.org/sqlite-wasm` only with `import type`, and the package is a
  devDependency plus an optional peer, never a dependency the CLI would
  install.
- **The CSP is not loosened.** W2 changes nothing in `apps/backend`. If
  something is blocked, the fix goes in the web client.
- **Workspace command:**
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm -w exec turbo run build typecheck test`,
  then `pnpm lint`. Each task ends with both green.
- **Every requirement has a test that failed first.** Each task names the
  mutation that turns its tests red. Revert it after checking.
- **Commits:** Conventional Commits with a scope. The body says why. **No
  `Co-Authored-By` trailer.** Run `pnpm format` first. Never commit to
  `main`. Branch `feat/web-shell`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`. The candidate is `Web e2e`.

## Review Focus

1. **OPFS and leadership edges.** The new leader's `installOpfsSAHPoolVfs`
   can run before the dead leader's worker has released its access handles.
   Check that `worker.ts` retries the install with backoff and only then
   reports `fatal`. Check that the store sets no `journal_mode = WAL`. Check
   that the lock callback never resolves while the tab lives, since a
   resolved promise hands leadership away while the worker keeps the files.
   Check that the leader's own client uses a separate `BroadcastChannel`
   object from `leader.ts`, because a channel does not receive its own
   messages (Tasks 4, 7).
2. **CSP violations.** Look for anything that injects script at run time or
   reaches another origin. Candidates: `useHead({ script })`, an `on*`
   attribute, a blob: worker (`new Worker(URL.createObjectURL(…))`, which
   some plugins do), Iconify API fetches (`icon.provider` must be `'none'`),
   remote fonts, and Workbox's `importScripts` from a CDN (`generateSW`
   inlines or serves Workbox locally; check `sw.js`). Violations inside the
   dedicated worker do not fire on `document`. Check that `worker.ts`
   forwards them and that the fixture fails on them (Tasks 3, 6, 7).
3. **Cookie refresh races between tabs.** Only one worker refreshes at a
   time, and within it `cookieTokenSource.renew` is single-flight. The race
   that remains is a hand-over: the dead leader's refresh may have rotated
   the cookie while its response was lost. The new leader then presents the
   old cookie. That is safe only inside the server's 30-second grace
   window, which a hand-over stays within. Check that `renew` does not retry
   a 401 as a network error, and that a 429 on refresh does not sign out
   (Tasks 1, 4).
4. **Worker crash recovery.** If the worker dies (an uncaught error, a
   failed init, OPFS refused), requests must not hang and tabs must not spin
   forever. Check that `client.ts` times every request out (20 s) and
   resends pending requests on `ready`. Check that `leader.ts` respawns at
   most 3 times a minute, then publishes `engine: failed` with a reason the
   page shows. Check that `fatal` from init is posted, not thrown into the
   void (Tasks 4, 7).
5. **Stale service worker.** A tab running an old build against a new
   backend, or an old leader serving new followers, is the failure to look
   for. Check `registerType: 'prompt'` (never `autoUpdate`, which reloads
   under the user), `cleanupOutdatedCaches`, and a `navigateFallbackDenylist`
   that keeps `/api/` and `/health` off the SW fallback (an `/api` call
   answered with cached `index.html` is the trap-3 class of failure, moved
   into the browser). Check that every protocol message carries the build
   id, and that a mismatch shows the reload prompt instead of being
   processed (Tasks 4, 6).

---

### Task 0: Commit the plan and the task spec (controller)

- [ ] `specs/tasks/active/T-2026-10-02-web-shell.md` exists (FR-001…FR-014,
      steps T001–T008). Settle open questions 1–4 with the maintainer.
      Tasks 1 and 2 do not depend on the answers. Task 3 does, and has
      fallbacks.
- [ ] Commit `docs(plans): plan the web client shell (W2)` on
      `feat/web-shell`. Body: W2 of the client-shells design. The plan fixes
      the worker protocol, the cookie-mode session and the CSP-safe build
      before any code exists.

---

### Task 1: client-core: the cookie-mode session, and the account rule

Implements FR-001, FR-002 (T001). Departures 1, 2.

**Files:**

- Modify: `packages/client-core/src/auth.ts`, `auth.spec.ts`, `store.ts`
  (`StoredAuth` only)
- Modify: `apps/cli/src/run.ts` (import `adoptAccount`, delete `subject` and
  `adoptAccount`)

**Interfaces:**

```ts
// store.ts
/** An access token and when it lapses: what every session response carries. */
export type AccessGrant = { accessToken: string; accessExpiresAt: string };
/** The session as the body transport returns it (the CLI). */
export type StoredAuth = AccessGrant & { refreshToken: string };

// auth.ts
/** POST /auth/* with the refresh token in the HttpOnly cookie (ADR 0011). */
export type CookieAuthApi = {
  /** `'invalid'`: wrong email or password (401). */
  login(email: string, password: string): Promise<AccessGrant | 'invalid'>;
  /** `'invalid'`: no cookie, or one the server no longer accepts (401). */
  refresh(): Promise<AccessGrant | 'invalid'>;
  logout(accessToken: string): Promise<'unauthorized' | undefined>;
};

export type CookieTokenSource = TokenSource & {
  /** The grant a login returned; `undefined` after a logout, after which no
   *  refresh is tried until the next adopt. */
  adopt(grant: AccessGrant | undefined): void;
  /** False after a logout or a refused refresh. True before the first
   *  refresh too: the cookie may still hold a session. */
  signedIn(): boolean;
};

export function httpCookieAuthApi(config: HttpConfig): CookieAuthApi;
export function cookieTokenSource(api: CookieAuthApi, now: () => Date): CookieTokenSource;

/** The account an access token belongs to (`sub` of its payload segment). */
export function subject(token: string): string | undefined;
/** Moved verbatim from apps/cli/src/run.ts (departure 1). */
export function adoptAccount(store: Store, accessToken: string): void;
```

- [ ] **Step 0: Baseline.** On a clean tree, run the workspace command and
      write the per-package file and test counts into the PR description.
- [ ] **Step 1: Tests (red).** In `auth.spec.ts`, add a fake `CookieAuthApi`
      that records calls, and these specs:
  - `describe('cookieTokenSource')`:
    - before any grant, `current()` refreshes once and returns the new token;
    - a fresh grant from `adopt` is returned without calling the API;
    - a grant within 60 s of expiry is refreshed;
    - `current()` and `renew()` called together while a refresh is in flight
      call `api.refresh` **once** (single-flight). Both get the new token;
    - `renew(refused)` returns the held token without a call when it already
      differs from `refused`;
    - `refresh` → `'invalid'` rejects with a `RefusalError`, `signedIn()` is
      then false, and the next `current()` rejects **without** calling the
      API;
    - after `adopt(undefined)`, `current()` rejects without calling the API;
    - a network error (a plain `TypeError`) is retried once, and a second
      one propagates with `signedIn()` still true;
    - a `RefusalError` (a 429, say) is not retried and leaves `signedIn()`
      true.
  - `describe('httpCookieAuthApi')`, over the existing `serve` helper:
    - `login` sends exactly `{ email, password, transport: 'cookie' }`
      (`toEqual`);
    - `login` against a 200 with no `refreshToken` resolves to exactly
      `{ accessToken, accessExpiresAt }`;
    - a 200 that *does* carry `refreshToken` still resolves to those two keys
      only (`toStrictEqual` on the keys), so the token is never kept;
    - `login` 401 → `'invalid'`; 429 → `RefusalError`;
    - `refresh` sends exactly `{}`; 401 → `'invalid'`;
    - `logout` sends exactly `{}` with the bearer; 401 → `'unauthorized'`.
  - `describe('subject')`: a token whose payload segment holds `-` and `_`
    and has no padding decodes to its `sub`. Garbage → `undefined`.
- [ ] **Step 2: Code.** In `auth.ts`:

```ts
/** A lost response may have rotated the token; the server answers a repeat
 *  inside its grace window with the same successor. A refusal is an answer,
 *  not a loss, and is not retried. */
async function retryOnce<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof RefusalError) throw error;
    return call();
  }
}
```

  `tokenSource` calls `retryOnce(() => api.refresh(auth.refreshToken))`. It
  does not change otherwise.

```ts
/**
 * The web's session (ADR 0011): the refresh token is an HttpOnly cookie the
 * worker cannot read, so only the access token is held, in memory. One
 * worker per origin, so no lock: concurrent callers share one refresh.
 */
export function cookieTokenSource(
  api: CookieAuthApi,
  now: () => Date,
): CookieTokenSource {
  // 'unknown': not refreshed yet, the cookie may hold a session.
  // 'ended': logged out or refused; nothing to try until the next adopt.
  let grant: AccessGrant | 'unknown' | 'ended' = 'unknown';
  let inflight: Promise<string> | undefined;

  const refresh = (): Promise<string> =>
    (inflight ??= retryOnce(() => api.refresh())
      .then((next) => {
        if (next === 'invalid') {
          grant = 'ended';
          throw new RefusalError('your session has ended — sign in again');
        }
        grant = next;
        return next.accessToken;
      })
      .finally(() => (inflight = undefined)));

  const renew = async (refused: string): Promise<string | null> => {
    if (grant === 'ended') throw new RefusalError('signed out');
    if (typeof grant === 'object' && grant.accessToken !== refused) {
      return grant.accessToken;
    }
    return refresh();
  };

  return {
    async current() {
      if (typeof grant === 'object' &&
          Date.parse(grant.accessExpiresAt) - now().getTime() >= RENEW_WITHIN_MS) {
        return grant.accessToken;
      }
      return (await renew(typeof grant === 'object' ? grant.accessToken : '')) ?? '';
    },
    renew,
    adopt(next) {
      grant = next ?? 'ended';
    },
    signedIn: () => grant !== 'ended',
  };
}
```

  `httpCookieAuthApi` reuses `post` and `refuse` from `httpAuthApi`. Lift
  them to module-level helpers that take `config`, and add
  `credentials: 'same-origin'`. It maps 401 to `'invalid'`/`'unauthorized'`
  and picks the two grant fields by name. It never spreads the body.
  `subject` uses
  `atob(segment.replace(/-/g, '+').replace(/_/g, '/'))`, decoded through
  `TextDecoder`, inside the existing `try`. Move `adoptAccount` verbatim,
  message included (departure 7).
- [ ] **Step 3: CLI.** `run.ts` imports `adoptAccount` from
      `@todoer/client-core` and deletes its `subject` and `adoptAccount`.
      Nothing else in `apps/cli` changes.
- [ ] **Step 4: Run.** Run
      `pnpm -w exec turbo run build typecheck test --filter=@todoer/cli...`.
      Everything is green. The CLI's test count is unchanged, and
      `run.spec`'s account tests pass.
- [ ] **Step 5: Mutations.** (a) Drop `inflight ??=` (assign instead). The
      single-flight spec goes red. (b) Make `renew` skip the `'ended'`
      check. The "rejects without calling the API" specs go red. (c) Spread
      the login body into the grant. The "two keys only" spec goes red. (d)
      Decode `subject` without the `-`/`_` replacement. The `subject` spec
      goes red. Revert each.
- [ ] **Step 6: Commit.** Message:
      `feat(client-core): a cookie-mode session for the web client`. Body:
      ADR 0011 keeps the web's refresh token out of reach of script, so the
      web holds only an access token, in its worker's memory, and refreshes
      through the cookie. The account rule moves here too, because the web
      must refuse the same foreign-outbox sign-in the CLI refuses. Tick
      T001.

---

### Task 2: client-core: the `./sqlite-wasm` adapter

Implements FR-003 (T002).

**Files:**

- Create: `packages/client-core/src/sqlite-wasm.ts`,
  `packages/client-core/src/sqlite-wasm.spec.ts`,
  `packages/client-core/src/sql-database.contract.ts` (a spec helper,
  excluded from the build like `test-store.ts`)
- Modify: `packages/client-core/package.json` (`exports['./sqlite-wasm']`,
  devDependency and optional peer `@sqlite.org/sqlite-wasm`),
  `tsconfig.build.json` (exclude the contract helper),
  `packages/client-core/src/node-sqlite.spec.ts` (new: runs the contract
  against `NodeSqlite(':memory:')`)

**Interfaces:**

```ts
import type { CAPI, Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';

/** SqlDatabase over sqlite-wasm's oo1 (design Q12). One connection, owned by
 *  the leader's worker: withWriteLock queues callers in this worker instead
 *  of polling across processes as NodeSqlite does. */
export class WasmSqlite implements SqlDatabase {
  constructor(db: Database, capi: CAPI);
}

/** Schema applied, rollback journal kept (opfs-sahpool has no WAL). */
export function openWasmStore(sqlite3: Sqlite3Static, db: Database): Store;
```

- [ ] **Step 1: Contract (red).** `sql-database.contract.ts` exports
      `sqlDatabaseContract(name, open: () => SqlDatabase | Promise<SqlDatabase>)`.
      It is a `describe` block of:
  - `run` with params stores those values. `all` with params filters by
    them. Both work with no params, an empty array and `undefined`;
  - `all` returns plain column-keyed objects (`toEqual({ a: 1, b: 'x' })`);
  - `inTransaction` is false, true after `BEGIN`, false after `COMMIT` and
    after `ROLLBACK`;
  - `withWriteLock` commits on resolve and rolls back on reject. The
    rejection propagates, and `inTransaction` is false afterwards;
  - two overlapping `withWriteLock` calls run one after the other: the
    second body starts only after the first committed, and neither throws;
  - a body that ends the transaction itself (`exec('ROLLBACK')`) and then
    throws: the original error propagates, not "no transaction is active".

  `node-sqlite.spec.ts` runs it against `new NodeSqlite(':memory:')`. That
  shows the contract describes the adapter that already ships.
  `sqlite-wasm.spec.ts` runs it against
  `new WasmSqlite(new sqlite3.oo1.DB(':memory:', 'c'), sqlite3.capi)`, with
  `sqlite3 = await sqlite3InitModule({ print() {}, printErr() {} })` in a
  `beforeAll`. It also runs one end-to-end case: `openWasmStore`, then
  `flush` against a fake transport that answers with two task changes, and
  then `store.rows('task')` holds them and `store.cursor()` advanced.
- [ ] **Step 2: Code.**

```ts
export class WasmSqlite implements SqlDatabase {
  // ponytail: one queue for the whole worker; per-table locks never needed.
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Database, private readonly capi: CAPI) {}

  get inTransaction(): boolean {
    return this.capi.sqlite3_get_autocommit(this.db.pointer!) === 0;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    // Design W0 note: bind only when there is something to bind.
    this.db.exec(params.length === 0 ? { sql } : { sql, bind: [...params] });
  }

  all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
    return this.db.exec({
      sql,
      ...(params.length === 0 ? {} : { bind: [...params] }),
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as T[];
  }

  /** BEGIN IMMEDIATE held across awaits. A second caller in this worker
   *  waits its turn; there is no other process to wait for. */
  withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const turn = async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        if (this.inTransaction) this.db.exec('ROLLBACK');
        throw error;
      }
    };
    const result = this.tail.then(turn, turn);
    this.tail = result.catch(() => undefined);
    return result;
  }

  close(): void {
    this.db.close();
  }
}
```

  `all` returns null-prototype rows. `Store` only reads their fields, so no
  copy is made. If the contract's `toEqual` objects to the prototype, map
  with `{ ...row }` and say so in a comment.
- [ ] **Step 3: Package.** `exports['./sqlite-wasm'] = { types:
      './dist/sqlite-wasm.d.ts', default: './dist/sqlite-wasm.js' }`.
      `devDependencies['@sqlite.org/sqlite-wasm'] = '3.53.4-build1'`.
      `peerDependencies` gets the same, with
      `peerDependenciesMeta: { '@sqlite.org/sqlite-wasm': { optional: true } }`.
      The ESLint portable-entry rule already covers `sqlite-wasm.ts`, which
      imports no Node module.
- [ ] **Step 4: Run.** Run the workspace command and `pnpm lint`. Check
      `rg -n "sqlite-wasm" packages/client-core/dist/index.d.ts` is empty.
- [ ] **Step 5: Mutations.** (a) Drop `this.tail = …` (no queue). The
      overlapping-locks contract case goes red for `WasmSqlite` with
      "cannot start a transaction within a transaction". (b) Make
      `inTransaction` return `false`. The rollback cases go red. (c) Drop
      `bind` from `run`. The params case reads NULLs and goes red (Verified
      facts: a missing bind is silent). Revert each.
- [ ] **Step 6: Commit.** Message:
      `feat(client-core): an oo1 adapter for the web worker (./sqlite-wasm)`.
      Body: design Q12 and W0 departure 3. The same `SqlDatabase` contract
      now runs against both adapters, so the web cannot drift from what the
      CLI's specs assume. Tick T002.

**Checkpoint:** client-core can run in the browser worker, and holds the
web's session without seeing its refresh token. The CLI is unchanged.

---

### Task 3: `apps/web`: the Nuxt scaffold under the backend's CSP

Implements FR-004, FR-005 (T003). Departures 3, 5.

**Files:**

- Create: `apps/web/package.json`, `nuxt.config.ts`, `tsconfig.json`,
  `turbo.json`, `vitest.config.ts`, `app/app.vue`, `app/pages/index.vue`,
  `app/assets/css/main.css`, `i18n/locales/en.json`,
  `i18n/locales/ru.json`, `i18n/locales.spec.ts`, `public/icon.svg`
- Modify: `.gitignore`, `.prettierignore` (`.nuxt/`, `.output/`,
  `playwright-report/`, `test-results/`), `eslint.config.mjs` (ignore
  `**/.nuxt/`, `**/.output/`; `disableTypeChecked` for `apps/web/**`)

**`package.json`:**

```json
{
  "name": "@todoer/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt generate",
    "postinstall": "nuxt prepare",
    "typecheck": "nuxt typecheck",
    "test": "vitest run",
    "lint": "eslint .",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@nuxt/ui": "^4.11.3",
    "@nuxtjs/i18n": "^10.6.0",
    "@sqlite.org/sqlite-wasm": "3.53.4-build1",
    "@todoer/client-core": "workspace:^",
    "@vite-pwa/nuxt": "^1.1.1",
    "nuxt": "^4.5.2",
    "tailwindcss": "^4.3.3"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "typescript": "^5.6.3",
    "vitest": "^5.0.2",
    "vue-tsc": "^3.3.11",
    "@iconify-json/lucide": "^1.2.138"
  }
}
```

  `@vite-pwa/nuxt` and `@playwright/test` are listed here and first used in
  Tasks 6 and 7. That keeps one lockfile change. If open question 1 is
  answered no, `typecheck` is `vue-tsc`-less: `nuxt prepare && tsc --noEmit
  -p .nuxt/tsconfig.app.json`, which checks the `.ts` files only. Say so in
  the PR. If question 2 is answered no, the icons Nuxt UI needs go into a
  local collection, `app/assets/icons/*.svg` (copied from Lucide, ISC
  license), registered with
  `icon.customCollections: [{ prefix: 'lucide', dir: './app/assets/icons' }]`.

**`nuxt.config.ts`:**

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  modules: ['@nuxt/ui', '@nuxtjs/i18n'], // '@vite-pwa/nuxt' joins in Task 6
  css: ['~/assets/css/main.css'],
  // The backend caches /_nuxt/ as immutable and everything else as no-cache
  // (W1 notes): stated, not defaulted, so a change here is a visible one.
  app: { buildAssetsDir: '/_nuxt/' },
  // 3000 is the backend's default.
  devServer: { port: 3001 },
  // One origin in development too (Q9): the cookie's Path is /api/v1/auth.
  nitro: {
    devProxy: { '/api': { target: 'http://localhost:3000/api', changeOrigin: true } },
  },
  // Departure 5: no build-time font download, nothing served from /_fonts/.
  ui: { fonts: false },
  // connect-src is 'self': the Iconify API is unreachable. Icons ship in
  // the client bundle.
  icon: { provider: 'none', clientBundle: { scan: true } },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'ru', name: 'Русский', file: 'ru.json' },
    ],
    detectBrowserLanguage: { useCookie: true, cookieKey: 'todoer_locale' },
  },
  vite: {
    // The worker imports client-core and sqlite-wasm: ES workers, no blob:.
    worker: { format: 'es' },
    // sqlite-wasm finds its .wasm by import.meta.url; pre-bundling breaks it.
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  },
});
```

  `app.vue` is `<UApp :locale="uiLocale"><NuxtPage /></UApp>`, with
  `uiLocale` picked from `@nuxt/ui/locale` (`en`/`ru`) by `useI18n().locale`.
  `index.vue` shows `$t('app.title')` and a locale switcher, and nothing
  else yet. `main.css` is `@import "tailwindcss"; @import "@nuxt/ui";`.
  `turbo.json` is `{ "extends": ["//"], "tasks": { "build": { "outputs":
  [".output/**"] } } }`.

- [ ] **Step 1: Test (red).** `i18n/locales.spec.ts`: the flattened key sets
      of `en.json` and `ru.json` are equal, and no value is empty. Write it
      first, against a `ru.json` missing `app.title`.
- [ ] **Step 2: Scaffold.** Create the files above and run `pnpm install`.
      The lockfile change is the only one in the workspace. Check
      `git diff --stat pnpm-lock.yaml` names no package outside the approved
      list and the open-question pair, other than their transitive
      dependencies.
- [ ] **Step 3: Build and serve.** Run
      `pnpm -w exec turbo run build --filter=@todoer/web...`, then:

```sh
rg -l "fonts.googleapis|fonts.gstatic|api.iconify|api.simplesvg|api.unisvg" apps/web/.output/public   # empty
rg -c "<script" apps/web/.output/public/index.html                                                 # note the count
WEB_ROOT=$PWD/apps/web/.output/public PORT=3010 DATABASE_URL=… JWT_SECRET=… node apps/backend/dist/main.js
```

      Open `http://localhost:3010/` in Chromium with the devtools console
      open. There is no CSP error, the title shows, and the locale switch
      works. Write the inline-script count and the console state into the
      PR. Task 7 turns this manual check into a test.
- [ ] **Step 4: Gates.** Run the workspace command and `pnpm lint`. The
      Workspace tests job now builds, typechecks and tests `@todoer/web`.
      Write the job's added wall time into the PR.
- [ ] **Step 5: Mutation.** Set `icon.provider` back to its default. The
      `rg` for `api.iconify` hits, or the console shows a `connect-src`
      violation on load. Revert.
- [ ] **Step 6: Commit.** Message:
      `feat(web): a Nuxt SPA scaffold that runs under the backend's CSP`.
      Body: Q2, Q19 and the W1 notes. Icons and fonts are bundled because
      `connect-src` is `'self'`, and assets stay under `/_nuxt/` because the
      backend's immutable cache assumes it. Tick T003.

---

### Task 4: The worker, the protocol and the leader tab

Implements FR-006, FR-007, FR-008, and the engine half of FR-009 (T004).
Departure 4.

**Files:**

- Create: `apps/web/app/db/protocol.ts`, `engine.ts`, `engine.spec.ts`,
  `worker.ts`, `leader.ts`, `client.ts`, `client.spec.ts`
- Create: `apps/web/app/plugins/db.client.ts`

**Protocol (`protocol.ts`, types and three constants only):**

```ts
export const CHANNEL = 'todoer';
export const LEADER_LOCK = 'todoer:leader';

export type SyncReason = 'start' | 'write' | 'tick' | 'focus' | 'online' | 'manual';

export type Command =
  | { kind: 'signIn'; email: string; password: string }
  | { kind: 'signOut' }
  | { kind: 'sync'; reason: SyncReason };

/** One i18n key per kind (`errors.<kind>`); locales.spec.ts checks both files. */
export const FAILURE_KINDS = [
  'invalid-credentials', // login 401
  'refused', // any other refusal (429, a foreign outbox, …)
  'unreachable', // network error or timeout
  'signed-out', // the session ended
  'unavailable', // no worker answered in time
  'unexpected',
] as const;

export type Failure = {
  kind: (typeof FAILURE_KINDS)[number];
  /** The core's own text, shown as a detail line only (departure 7). */
  detail: string;
};
export type Result = { ok: true } | { ok: false; failure: Failure };

export type Topics = {
  engine: { state: 'starting' | 'ready' | 'failed'; reason: string | null };
  session: { state: 'restoring' | 'signed-out' | 'signed-in'; reason: Failure['kind'] | null };
  sync: {
    running: boolean;
    /** null until the first attempt; false when the server was not reached. */
    reached: boolean | null;
    lastSyncedAt: string | null;
    pending: number;
    failed: number;
    problem: string | null;
  };
  /** The placeholder's proof of sync (W3 replaces it with views). */
  summary: { tasks: number };
};
export type Topic = keyof Topics;

/** Every message names the build that sent it; a mismatch is a stale tab. */
type Stamped<T> = T & { build: string };

export type ToWorker = Stamped<
  | { type: 'request'; tab: string; id: number; command: Command }
  | { type: 'hello'; tab: string } // publish every topic for me
>;
export type FromWorker = Stamped<
  | { type: 'reply'; tab: string; id: number; result: Result }
  | { [T in Topic]: { type: 'publish'; topic: T; value: Topics[T] } }[Topic]
  | { type: 'ready' } // a worker (re)started: resend what is pending
  | { type: 'violation'; directive: string; blocked: string } // CSP, from inside the worker
>;

/** Leader tab → its dedicated worker, over postMessage, once. */
export type Init = { type: 'init'; build: string; hint: boolean };
/** Worker → leader tab, over postMessage: init failed. */
export type Fatal = { type: 'fatal'; reason: string };
```

  Every tab, the leader included, talks to the worker over
  `BroadcastChannel(CHANNEL)`. A channel delivers to every *other* object of
  that name in the origin, the worker's included, and never to the sender.
  So the leader's client and `leader.ts` each open their own instance. That
  gives one code path for leader and follower.

**Engine (`engine.ts`):**

```ts
export type EngineDeps = {
  store: Store;
  auth: CookieAuthApi;
  tokens: CookieTokenSource;
  send: Transport;
  now: () => Date;
  publish: <T extends Topic>(topic: T, value: Topics[T]) => void;
};

export function createEngine(deps: EngineDeps): {
  /** Restore the session from the cookie when the hint says one may exist. */
  start(hint: boolean): Promise<void>;
  handle(command: Command): Promise<Result>;
  /** Publish every topic (a tab said hello). */
  snapshot(): void;
};
```

  The engine's behaviour:

  - `start(false)` → `session: signed-out`, with no network. `start(true)`
    → `tokens.current()`. On success: `adoptAccount`, then signed-in, then
    `sync('start')`. On a `RefusalError`: signed-out. On a network error:
    signed-in if `store.owner()` is set (an offline start, `reached: false`),
    else signed-out.
  - `signIn` → `auth.login`. `'invalid'` → `invalid-credentials`. Then
    `adoptAccount`. If it refuses (a foreign outbox), call
    `auth.logout(grant.accessToken)` best-effort, so the cookie does not
    outlive the refusal, and return `refused`. Then `tokens.adopt(grant)`,
    publish signed-in, `sync('start')`.
  - `signOut` → `bearer = await tokens.current()` (refreshes an expired
    token first: W1 note) → `auth.logout(bearer)`. On `'unauthorized'`,
    renew once and retry, as the CLI's `revoke` does. Network errors and
    refusals are swallowed. Then `tokens.adopt(undefined)` and publish
    signed-out. The replica stays (open question 4).
  - `signIn` and `signOut` run through one promise chain, so they never
    overlap. `sync` is single-flight. A call during a run sets `again`, and
    the run repeats once (a `tick` during a run is dropped instead). It
    only runs when signed in. `flush(store, send)`: `synced` →
    `reached: true`, `lastSyncedAt = now()`; not synced → `reached: false`.
    A `RefusalError` with `!tokens.signedIn()` publishes
    `session: signed-out` with reason `signed-out`. Any other error sets
    `sync.problem`. Every run ends by publishing `sync` (with
    `store.counts()`) and `summary`
    (`liveTasks(overlay('task', store.rows('task'), store.pending())).length`).

**Worker (`worker.ts`), glue only:**

```ts
self.onmessage = async ({ data }: MessageEvent<Init>) => {
  try {
    const sqlite3 = await sqlite3InitModule();
    // The previous leader's worker may still hold the pool's handles for a
    // moment after its tab closed (Review Focus 1).
    const pool = await retry(() => sqlite3.installOpfsSAHPoolVfs({ name: 'todoer' }),
                             { attempts: 10, firstDelayMs: 100, maxDelayMs: 1000 });
    const store = openWasmStore(sqlite3, new pool.OpfsSAHPoolDb('/todoer.sqlite3'));
    const config = { base: '/api/v1', timeoutMs: 10_000 };
    const auth = httpCookieAuthApi(config);
    const tokens = cookieTokenSource(auth, () => new Date());
    const channel = new BroadcastChannel(CHANNEL);
    const post = (m: Omit<FromWorker, 'build'>) => channel.postMessage({ ...m, build: data.build });
    const engine = createEngine({ store, auth, tokens, send: httpTransport(config, tokens),
      now: () => new Date(), publish: (topic, value) => post({ type: 'publish', topic, value }) });
    channel.onmessage = ({ data: m }: MessageEvent<ToWorker>) => {
      if (m.build !== data.build) return void post({ type: 'ready' }); // lets the stale tab see it
      if (m.type === 'hello') return engine.snapshot();
      if (m.type === 'request') void engine.handle(m.command)
        .then((result) => post({ type: 'reply', tab: m.tab, id: m.id, result }));
    };
    // A violation inside a worker fires here, not on any document (Review Focus 2).
    self.addEventListener('securitypolicyviolation', (e) =>
      post({ type: 'violation', directive: e.effectiveDirective, blocked: e.blockedURI }));
    post({ type: 'ready' });
    post({ type: 'publish', topic: 'engine', value: { state: 'ready', reason: null } });
    await engine.start(data.hint);
  } catch (error) {
    self.postMessage({ type: 'fatal', reason: String(error) } satisfies Fatal);
  }
};
```

  `retry` is a ten-line local helper in `worker.ts`. `engine.handle` never
  rejects: it maps every error to a `Failure`. If the browser has no
  `installOpfsSAHPoolVfs` path (no OPFS), init throws, and the reason
  reaches the page through `fatal` → `engine: failed`.

**Leader (`leader.ts`):**

```ts
/** Wins the lock or queues for it; the winner owns the worker until the tab
 *  goes away. The callback's promise never settles on purpose: settling it
 *  would hand leadership over while this worker still holds the database. */
export function lead(build: string, hint: () => boolean): void;
```

  Inside the lock: publish `engine: starting` on a `BroadcastChannel` of its
  own, then spawn
  `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'todoer-db' })`
  and post `Init`. On `error`, `messageerror` or `Fatal`: terminate, record
  the time, and respawn after `500 ms × failures`. On a third failure within
  60 s, publish `engine: failed` with the last reason and stop.

**Client (`client.ts`):**

```ts
export type Db = {
  request(command: Command): Promise<Result>;
  topics: { [T in Topic]: Readonly<ShallowRef<Topics[T] | undefined>> };
  /** A message from another build arrived: this tab or the leader is stale. */
  stale: Readonly<ShallowRef<boolean>>;
  close(): void;
};
export function connect(build: string, options?: { timeoutMs?: number }): Db;
```

  `connect` opens its own channel, sends `hello`, and keeps a pending map
  keyed by request id. A request is posted at once and posted again on every
  `ready`, because the worker may not exist yet or may have restarted. It
  resolves on its `reply`, or after `timeoutMs` (20 s) to
  `{ ok: false, failure: { kind: 'unavailable', … } }`. A `violation`
  message is logged with `console.error('[csp]', …)`, where Task 7's fixture
  sees it. Any message with another build sets `stale` and is otherwise
  ignored. `tab` is `crypto.randomUUID()`. `shallowRef` is imported from
  `vue` explicitly, not auto-imported, so the spec runs in plain Node.

**Plugin (`db.client.ts`):** if `!window.isSecureContext`, provide
`$db = null` and stop (the page shows the HTTPS message, Q11). Otherwise
take `build` from `useRuntimeConfig().app.buildId` and call
`lead(build, () => readHint())`. Then `provide('db', connect(build))`, and
`watch` the `session` topic to write or clear `localStorage['todoer.session']`
(departure 4). Every `localStorage` access sits in `try`/`catch`. A storage
that throws reads as "no hint".

- [ ] **Step 1: Engine tests (red).** `engine.spec.ts` builds the engine
      over `openWasmStore(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'))`, a
      fake `CookieAuthApi`, the real `cookieTokenSource`, a fake
      `Transport` returning canned `SyncResponse`s, and a `publish` that
      records. Cases:
  - `start(false)`: publishes `session: signed-out`, makes no auth call;
  - `start(true)` with a refresh that succeeds: signed-in, then one sync,
    then `summary.tasks` equals the live tasks in the canned response;
  - `start(true)` with refresh `'invalid'`: signed-out, no sync;
  - `start(true)` with a network error and an owner on record: signed-in,
    `sync.reached === false`. Without an owner: signed-out;
  - `signIn` 401 → `invalid-credentials`, the session stays signed-out;
  - `signIn` as another account with a pending op → `refused`, logout
    called, the replica untouched. With an empty outbox → the replica reset,
    then signed-in;
  - `signOut` with an expired grant refreshes first, then logs out with the
    new bearer. Then signed-out, and a later `sync` makes no request;
  - three `sync` calls during one in-flight run cause exactly two
    exchanges. A `tick` during a run causes none;
  - a 401 on `/sync` with refresh `'invalid'` → `session: signed-out`,
    reason `signed-out`;
  - a pending task op shows in `summary.tasks` before it is synced (the
    overlay).
- [ ] **Step 2: Client tests (red).** `client.spec.ts` uses Node's global
      `BroadcastChannel`, with a fake worker as a second channel object in
      the same test:
  - a request posted before any worker exists is answered after the fake
    worker posts `ready` and replies;
  - a reply for another tab's id is ignored;
  - no reply within `timeoutMs` (set to 50) → `unavailable`;
  - `publish` messages update `topics.<topic>.value`;
  - a message with another build sets `stale` and does not update topics;
  - a `violation` message reaches `console.error` (spy).
- [ ] **Step 3: Code.** Write `protocol.ts`, `engine.ts`, `client.ts`,
      `leader.ts`, `worker.ts` and the plugin as above. Point
      `vitest.config.ts` at `app/**/*.spec.ts` and `i18n/**/*.spec.ts`, with
      `environment: 'node'`.
- [ ] **Step 4: Manual check in a browser.** Build, serve with `WEB_ROOT` as
      in Task 3, and open two tabs. In the devtools Application panel, one
      worker `todoer-db` exists, and OPFS holds the pool directory. Closing
      the first tab starts a worker in the second. Check that
      `/_nuxt/*.wasm` is served with `Content-Type: application/wasm`
      (`curl -sI`). Write the results into the PR. Task 7 automates them.
- [ ] **Step 5: Run.** Run the workspace command and `pnpm lint`.
- [ ] **Step 6: Mutations.** (a) In `client.ts`, do not resend on `ready`.
      The "before any worker exists" spec goes red. (b) In `engine.ts`,
      drop the `again` loop. The coalescing spec goes red. (c) Call
      `adoptAccount` after `tokens.adopt`. The foreign-outbox spec still
      refuses, but its "logout called" assertion goes red, because the order
      also decides whether the cookie is cleared. (d) Make `start` refresh
      regardless of the hint. The `start(false)` spec goes red. Revert each.
- [ ] **Step 7: Commit.** Message:
      `feat(web): the leader tab's worker and the protocol every tab speaks`.
      Body: Q10, Q12 and Q13. One channel protocol for leader and followers.
      The worker runs the unchanged core over OPFS, and a build id on every
      message turns a stale tab into a visible prompt instead of a
      half-understood conversation. Tick T004.

---

### Task 5: Sign-in, the sync cadence, and the placeholder screen

Implements FR-009, FR-010 (T005).

**Files:**

- Create: `apps/web/app/components/SignInForm.vue`,
  `apps/web/app/components/ReplicaSummary.vue`
- Modify: `apps/web/app/pages/index.vue`, `apps/web/app/plugins/db.client.ts`
  (cadence), `i18n/locales/{en,ru}.json`

**Behaviour:**

- `index.vue` switches on state. `$db === null` → the HTTPS message (Q11,
  in both languages, naming the reverse proxy and `localhost`).
  `engine.state === 'failed'` → the reason and a reload button. `starting`
  or `session: restoring` → a skeleton. `signed-out` → `SignInForm`.
  `signed-in` → `ReplicaSummary`.
- `SignInForm`: `UForm` with email and password, submit disabled while the
  request is pending, and one `UAlert` with the i18n text for
  `failure.kind`. Nuxt UI form validation runs without a schema library: the
  native `required` and `type="email"` are enough, and they need no new
  dependency. No inline handlers: Vue's `@submit` compiles to
  `addEventListener`, which the CSP allows.
- `ReplicaSummary`: "N tasks" (with an i18n plural), `lastSyncedAt` as a
  relative time via `Intl.RelativeTimeFormat` in the active locale,
  pending/failed counts, an "offline" badge when `reached === false`, a
  **Sync now** button (`reason: 'manual'`), and **Sign out**. Each element
  carries a `data-testid` for Task 7 (`task-count`, `offline`, `sync-now`,
  `sign-out`).
- Cadence, in the plugin, in every tab. A
  `setInterval(30_000)` sends `sync: tick` when
  `document.visibilityState === 'visible'`. Window `focus` and
  `visibilitychange` to visible send `sync: focus`. Window `online` sends
  `sync: online`. The worker syncs on start by itself (Task 4). `write` is
  defined, but nothing sends it until W3's first write command does: Q14's
  "after every write" is that call. Multiple visible tabs are harmless,
  because the engine drops a `tick` during a run.

- [ ] **Step 1: Test (red).** Extend `locales.spec.ts`: every
      `Failure['kind']` has an `errors.<kind>` key in both files. It imports
      `FAILURE_KINDS` from `protocol.ts`, the array the `Failure` type
      derives from, so the spec and the type cannot drift.
- [ ] **Step 2: Code.** Write the components, the page and the cadence.
- [ ] **Step 3: Manual check.** Build and serve with `WEB_ROOT` against a
      local database. Register a user with the CLI flow, as
      `scripts/lib/fresh-user.sh` does, and sign in through the form. The
      count shows 0. Run `todoer add` with that user's token, focus the
      tab, and the count shows 1. Reload, and you are still signed in (the
      cookie refresh through the hint). Sign out, reload, and the form
      shows with no refresh request in the network panel (departure 4).
      Write the results into the PR.
- [ ] **Step 4: Run.** Run the workspace command and `pnpm lint`.
- [ ] **Step 5: Mutation.** Remove `errors.unreachable` from `ru.json`. The
      locale spec goes red. Revert.
- [ ] **Step 6: Commit.** Message:
      `feat(web): sign in with the refresh cookie and show the replica syncing`.
      Body: the placeholder exists to prove the loop, a CLI write showing up
      in the browser. It is not a feature screen. Q14's cadence lives in the
      tabs, and the worker coalesces it. Tick T005.

**Checkpoint:** a person can sign in from a browser, see a CLI write arrive,
reload without signing in again, and open a second tab that shares the same
worker.

---

### Task 6: The service worker and the update prompt

Implements FR-011 (T006).

**Files:**

- Modify: `apps/web/nuxt.config.ts` (module and `pwa` block),
  `apps/web/app/app.vue`
- Create: `apps/web/app/components/UpdatePrompt.vue`

**`pwa` block:**

```ts
pwa: {
  registerType: 'prompt', // never reload under the user (Review Focus 5)
  strategies: 'generateSW',
  manifest: {
    name: 'todoer', short_name: 'todoer', start_url: '/', display: 'standalone',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,wasm,svg,json,webmanifest}'],
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // sqlite3.wasm is ~0.9 MB
    cleanupOutdatedCaches: true,
    navigateFallback: '/index.html',
    // The API and health are never answered from the cache (Q9 "Cost").
    navigateFallbackDenylist: [/^\/api(\/|$)/i, /^\/health(\/|$)/i],
  },
  client: { installPrompt: false, periodicSyncForUpdates: 3600 },
},
```

  `UpdatePrompt.vue` shows a persistent `UAlert` with a **Reload** button
  when `$pwa.needRefresh` is true, or when `$db.stale` is true. Reload calls
  `$pwa.updateServiceWorker(true)`, or `location.reload()` when only
  `stale` is set. `app.vue` mounts it above `NuxtPage`.

- [ ] **Step 1: No unit test, by design.** What this task makes true lives
      in a browser: a controlling SW, an `/api` navigation it refuses, an
      offline reload it serves. A Vitest spec over `sw.js` would need the
      web's own build, and turbo runs `test` after `^build` only, so it
      would pass vacuously in CI. FR-011's tests are Task 7's "SW never
      answers `/api`" and "offline, then online". Task 7 Step 4 (d)
      shows them red without this task. Until then, check the build
      by hand: `sw.js` exists, it has no `importScripts("https:`, and its
      precache list names a `.wasm` file and `index.html`.
- [ ] **Step 2: Code.** Add the module, the block and the component.
- [ ] **Step 3: Manual check.** Build and serve. The page is controlled by
      `sw.js` after one reload. `GET /api/v1/health` with the SW active
      returns JSON. Rebuild with a changed `app.title`, restart the backend,
      and focus the tab. The prompt appears, and **Reload** shows the new
      title. Write the results into the PR. The two-build path is not
      automated (What this plan does not do).
- [ ] **Step 4: Run.** Run the workspace command and `pnpm lint`.
- [ ] **Step 5: Mutation.** Drop the `navigateFallbackDenylist`, rebuild,
      and repeat the health check with the SW active. It answers HTML.
      Revert.
- [ ] **Step 6: Commit.** Message:
      `feat(web): an offline app shell with an update prompt`. Body: Q9's
      cost. The SPA is cached, so an old tab must learn that a new build
      exists, and must never answer `/api` from its cache. Tick T006.

---

### Task 7: Playwright against the built SPA, and the `Web e2e` job

Implements FR-012, FR-013 (T007). Departure 8.

**Files:**

- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/fixtures.ts`,
  `apps/web/e2e/shell.spec.ts`, `apps/web/e2e/tabs.spec.ts`,
  `apps/web/e2e/offline.spec.ts`
- Modify: `.github/workflows/test.yml` (new job `web-e2e`, name `Web e2e`),
  `apps/web/vitest.config.ts` (exclude `e2e/`)

**`playwright.config.ts`:**

```ts
const port = 3010;
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false, // one backend, per-IP auth budgets (fixtures.ts)
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  // `localhost`, never 127.0.0.1: only the name is a secure context for the
  // Secure cookie in every engine that runs here.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }, // departure 8
  ],
  webServer: {
    command: 'node ../backend/dist/main.js',
    url: `http://localhost:${port}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(port),
      WEB_ROOT: fileURLToPath(new URL('./.output/public', import.meta.url)),
      DATABASE_URL: required('DATABASE_URL'),
      JWT_SECRET: required('JWT_SECRET'),
    },
  },
});
```

  The suite runs with plain `pnpm --filter @todoer/web e2e`, not through
  turbo, so trap 2's environment filter never applies.

**Fixtures (`fixtures.ts`):**

- `account` (worker-scoped owner, test-scoped user). This is the
  `fresh-user.sh` flow over Playwright's `request`. The owner registers or
  logs in once per worker. Each test gets an invitation and a fresh user
  registered with the **body** transport, so the CLI gets an access token.
  The fixture returns `{ email, password, token }`. Budget: one login per
  worker, plus one registration and one UI sign-in per test. That stays
  under the server's 20 per 15 minutes per IP for both browsers. A 429
  fails with the limit's name, not a timeout.
- `cli(token, ...args)` runs `node apps/cli/dist/index.js` with
  `HOME=<tmpdir>`, `TODOER_TOKEN`, and `TODOER_URL=http://localhost:3010/api/v1`.
- `page` (overridden) fails the test on any CSP violation. It does three
  things. `page.addInitScript` registers a `securitypolicyviolation`
  listener that pushes onto `window.__violations`; init scripts run outside
  the page's CSP, and `bypassCSP` stays false. `page.on('console')` collects
  errors matching `/Content.Security.Policy|Refused to|\[csp\]/`, which
  covers the worker's forwarded violations. `page.on('request')` collects
  any URL whose origin is not `baseURL`'s. `afterEach` asserts all three
  are empty. It reads `__violations` for every page still open. A closed
  page's violations reached the console collector before it closed.

**Tests:**

- `shell.spec.ts`
  - *signs in and sees a CLI write.* Open `/` and sign in with the form.
    `task-count` shows 0. `cli(token, 'add', 'from the cli')`. Dispatch
    `window.dispatchEvent(new Event('focus'))`, and `task-count` shows 1
    within 10 s.
  - *the 30 s tick syncs a visible tab.* `page.clock.install()` before
    `goto`, sign in, `cli add`, `page.clock.runFor(30_000)`, then 1. The
    clock drives the tab's interval only. The worker's network runs in real
    time.
  - *a reload restores the session through the cookie.* Sign in, reload, and
    the summary shows with no form. Then sign out and reload. The form
    shows, and no request to `/api/v1/auth/refresh` was made after the
    reload (`page.on('request')`).
  - *wrong password.* The alert shows the `invalid-credentials` text in
    the current locale. Switch to `ru`, and the text is Russian.
  - *the SW never answers `/api`.* After a reload the page is controlled
    (`navigator.serviceWorker.controller` set). `page.goto('/api/v1/health')`
    returns JSON with status 200.
- `tabs.spec.ts`
  - *a follower shares the leader's worker.* Page A signs in. Page B (same
    context) opens `/` and shows the summary without a form, with the same
    count. `cli add`, focus B, and A and B both show the new count.
  - *leadership passes when the leader closes.* Close A. B shows
    `engine: ready` again within 15 s (its own worker, after the sahpool
    retry), still signed in through the cookie and the hint. The count is
    unchanged, read from OPFS. `cli add`, focus B, and the count goes up.
- `offline.spec.ts`
  - *offline, then online.* Sign in and sync one task.
    `context.setOffline(true)`. Reload (the SW serves the shell). The
    summary shows the count from OPFS with the `offline` badge. `cli add`
    (the CLI is not offline). `context.setOffline(false)` fires `online`,
    the badge goes, and the count goes up by one. If Chromium's
    `setOffline` turns out not to reach the dedicated worker, the badge
    never shows and the test fails. Stop and report then. Do not weaken
    the assertion.

**CI job:**

```yaml
  # Not a required gate yet (CLAUDE.md, Quality gates): a candidate until it
  # has run green on a few PRs.
  web-e2e:
    name: Web e2e
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres: # as workspace-tests, but a fresh todoer_e2e: owner-first registration
        image: postgres:18.1-alpine
        env: { POSTGRES_USER: todoer, POSTGRES_PASSWORD: todoer, POSTGRES_DB: todoer_e2e }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://todoer:todoer@localhost:5432/todoer_e2e
      JWT_SECRET: ci-only-secret-at-least-32-characters-long
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Apply database migrations
        working-directory: apps/backend
        run: pnpm prisma migrate deploy
      - name: Build the backend, the CLI and the SPA
        run: pnpm -w exec turbo run build --filter=@todoer/backend... --filter=@todoer/cli... --filter=@todoer/web...
      - uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-1.63.0-${{ runner.os }}
      - name: Install the browsers
        run: pnpm --filter @todoer/web exec playwright install --with-deps chromium firefox
      - name: Run the web end-to-end suite
        run: pnpm --filter @todoer/web e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: apps/web/playwright-report, retention-days: 7 }
```

- [ ] **Step 1: Red first.** Write the fixture and `shell.spec.ts` "signs in
      and sees a CLI write". Add a deliberate `useHead({ script: [{
      innerHTML: '1' }] })` to `app.vue`, rebuild, and run Chromium only.
      The fixture fails on the CSP violation. Remove it. The test passes.
- [ ] **Step 2: The rest.** Write the remaining tests and run both projects
      locally against a scratch `todoer_e2e` database.
- [ ] **Step 3: Firefox.** If a Firefox test fails for an engine reason (it
      drops the `Secure` cookie on `http://localhost`, has no OPFS sync
      handle in the worker, or `setOffline` does not reach workers), mark
      only that test `test.skip(browserName === 'firefox', '<reason>')`. If
      sign-in itself fails, remove the project. Either way, record the
      evidence in the PR and in departure 8's paragraph (Task 8).
- [ ] **Step 4: Mutations.** (a) Comment out the worker's
      `securitypolicyviolation` forwarder, and add
      `new Worker(URL.createObjectURL(new Blob([''])))` to `worker.ts`'s
      init. Expect the suite to stay green: that shows why the forwarder
      exists. If it goes red anyway because Playwright already surfaces the
      worker's console, note that in the PR and keep the forwarder, which
      does not depend on Playwright. Restore the forwarder, and the suite
      goes red. Remove both. (b) In `leader.ts`, resolve the lock callback
      after spawning. The lock frees at once, B takes it while A lives,
      B's worker cannot open the pool A holds, and "a follower shares the
      leader's worker" fails with `engine: failed`. (c) Remove the hint check in the plugin. The
      "no refresh request" assertion goes red. (d) Remove `'@vite-pwa/nuxt'`
      from `modules` and rebuild. "The SW never answers `/api`" and
      "offline, then online" go red: FR-011's tests failing without Task 6.
      Revert each.
- [ ] **Step 5: CI.** Add the job. Push and confirm `Web e2e` runs green
      next to the four gates. Do not touch the gate names or the branch
      protection. Write the job's wall time into the PR.
- [ ] **Step 6: Commit.** Message:
      `test(web): Playwright against the built SPA under the real CSP`.
      Body: Q20 and the W1 notes. The suite runs the SPA the backend
      serves, with its policy, and fails on any violation, worker
      violations included. Two tabs and an offline reload are the
      behaviour only real engines show. Tick T007.

**Checkpoint:** sign-in, sync, two tabs, the hand-over and offline-online are
proven in a real engine on every PR, under the CSP the backend ships.

---

### Task 8: Docs, departures and the full proof

Implements FR-014 (T008).

**Files:** `README.md`, `docs/specs/2026-10-01-client-shells-design.md`,
`.claude/CLAUDE.md`, `specs/tasks/active/T-2026-10-02-web-shell.md`.

- [ ] **Step 1: README.**
  - "What works today": a bullet for the web client. It covers sign-in,
    sync and the replica count, two tabs, offline, RU/EN and an update
    prompt, and says the feature screens come in W3. Drop "the web client"
    from "Not built yet". Leave Flutter there.
  - Layout: an `apps/web/` row.
  - "Running it": `pnpm --filter @todoer/web dev` serves on 3001 and proxies
    `/api` to 3000. Use `http://localhost`, not `127.0.0.1`. Building:
    `pnpm -w exec turbo run build --filter=@todoer/web...`, then
    `WEB_ROOT=apps/web/.output/public`.
  - "Serving the web client": browser support. Chromium and Firefox are
    tested in CI (adjust per Task 7 Step 3). Safari is untested: OPFS needs
    16.4+, and its handling of `Secure` cookies on `http://localhost`
    differs, so use HTTPS. Also: signing out keeps the local replica (per
    the answer to open question 4), and the localStorage hint (departure 4).
  - "Tests": the e2e command (`pnpm --filter @todoer/web e2e` with
    `DATABASE_URL` naming a scratch database and `JWT_SECRET`), and
    `playwright install chromium firefox` once.
- [ ] **Step 2: Design doc.** Append "## Departures in plan W2", one
      paragraph per departure 1–8, with Task 7's Firefox evidence in 8. If
      the W1 "Safari and `Secure` cookies" paragraph is still open, add one
      line saying W2 left it documented, not tested.
- [ ] **Step 3: `.claude/CLAUDE.md`.** The stack: five packages. Add an
      `apps/web` row: "Nuxt 4 SPA. The leader tab's worker runs client-core
      on SQLite WASM (OPFS). Built SPA served by the backend from
      `WEB_ROOT`." In the client-core row, add "`./sqlite-wasm` is the
      web's". Quality gates: under the list, add one line naming
      `Web e2e` as a candidate, not required. "Running it": the e2e
      command.
- [ ] **Step 4: Stale-claim sweep.**

```sh
rg -n "web client itself is plan W2|Not built yet|the web and Flutter clients|Four packages|W2 decides" \
  README.md docs/specs .claude
```

  Every hit is updated or is a historical record (plans, earlier
  departures) that stays as written.
- [ ] **Step 5: Full proof.** Run the workspace command, then `pnpm lint`,
      then both shell e2e scripts against a fresh `todoer_e2e`, then the
      Playwright suite. Check that `git diff main -- scripts/ apps/backend`
      is empty, and that `git diff main -- apps/cli` holds only the
      `run.ts` import change.
- [ ] **Step 6: Commit.** Message:
      `docs: the web shell, its browser support and plan W2's departures`.
      Body: the README said the web client did not exist, and CLAUDE.md
      counted four packages. Tick T008. Move the task spec to `done/` per
      `specs/tasks/README.md`. Add the dnote changelog line. Add a tuxedo
      item for the production image (departure 6) and one for making
      `Web e2e` a required gate.

---

## What this plan does not do

- **No feature screens.** Lists, views, kanban, quick-add and the task card
  are W3. No UI sends a write yet, so `sync: write` is defined and unused.
- **No production Docker image** (departure 6).
- **No automated two-build update test.** It needs two builds and a backend
  restart inside one test. Task 6's manual check and the `stale` unit test
  cover it.
- **No WebKit run** (departure 8).
- **No server push.** Q14 polls, and SSE stays deferred.
- **No wiping of the replica on sign-out**, unless the maintainer answers
  open question 4 otherwise. A sign-in as another account resets it anyway
  (departure 1).
- **No tab-freezing handling.** A frozen background leader holds the lock
  while its worker is frozen too. Followers' requests then time out as
  `unavailable`. Browsers rarely freeze a tab that holds a Web Lock, and
  only field use will show whether it matters.
- **No `eslint-plugin-vue`** (departure 3).
