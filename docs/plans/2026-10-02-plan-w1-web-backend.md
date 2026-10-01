# Plan W1: the backend side of the web client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the backend can host the web client W2 builds, and the web client
can hold its session the way ADR 0011 says. Two features. First, with
`WEB_ROOT` set the backend serves a built SPA from the same origin as the API
(Q9): static files, an `index.html` fallback for page navigations, a
Content-Security-Policy that forbids inline script, and cache headers that
fit hashed assets. Second, the refresh token can travel in an `HttpOnly`,
`Secure`, `SameSite=Strict` cookie scoped to `/api/v1/auth`. A client opts in
per request, and the CLI keeps the body transport it has today, unchanged.

**Architecture:** `main.ts` keeps only process concerns (shutdown hooks,
`listen`). Building the app moves into `createApp()` in
`apps/backend/src/create-app.ts`: `NestFactory.create` with
`bodyParser: false`, then the middleware chain in its required order. A spec
can now boot the real chain on an ephemeral port and drive it with `fetch`;
until now no test ran `main.ts`'s middleware at all. The SPA is one
middleware, `spa(root)` in `apps/backend/src/web/spa.ts`, mounted first. It
never answers `/api/*` or `/health`, and only a `GET`/`HEAD` that accepts
`text/html` gets the fallback. It sits ahead of the validator, and
`express-openapi-validator` ignores every path outside its `/api/v1` base
path anyway. The cookie is three small functions in
`apps/backend/src/auth/refresh-cookie.ts`, used by the auth controller
through `@Res({ passthrough: true })`.

**Tech Stack:** NestJS 11 on Express 5 (`express.static`, `res.cookie`,
`res.clearCookie`), `express-openapi-validator` 5.6, `node:crypto` for the CSP
hashes, Vitest 5, `@hey-api/openapi-ts` codegen. No new dependencies.

**Spec:** [`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md)
covers Q9 (same origin), Q11 (HTTPS from the operator's proxy), Q16 (W1) and
"Departures in plan W0".
[ADR 0011](../adr/0011-bearer-everywhere-cookie-only-for-refresh.md) and its
plan D amendment;
[plan D design](../specs/2026-10-01-plan-d-auth-design.md), departure 2.
Task spec:
[`specs/tasks/active/T-2026-10-02-web-backend.md`](../../specs/tasks/active/T-2026-10-02-web-backend.md).

## Decisions this plan takes as given

The brief settled these. They are constraints here, not questions.

1. **`WEB_ROOT`** names a directory holding a built SPA. Unset means no static
   serving, exactly as today. Static files come from `express.static`, and a
   `GET`/`HEAD` outside `/api` and `/health` that accepts HTML gets
   `index.html`. `/api/*` and `/health` are never shadowed, and the validator
   never validates a static path. An HTTP-level test pins the order.
2. **The refresh cookie** is `HttpOnly; Secure; SameSite=Strict;
   Path=/api/v1/auth`. A client opts in with a contract field
   (`transport: 'cookie'`). The default stays the body, as today. In cookie
   mode the response sets the cookie and leaves `refreshToken` out of the
   body. Refresh takes a body token when one is present and the cookie
   otherwise. When it used the cookie, it rotates the cookie and leaves the
   token out of the body. Logout takes a body token or the cookie, and every
   204 clears the cookie. Rate limiting and the grace window behave the same
   for both transports. No cookie-parsing dependency.
3. **`TRUST_PROXY`** already exists (#407); W1 only cross-references it.
4. **No Docker image changes.** There is no Dockerfile yet, and the SPA does
   not exist until W2. W1 documents `WEB_ROOT` in the README.
5. **Spec first.** `openapi.yaml` changes before the backend does, and the
   codegen output gets its own commit.

## Verified facts (2026-10-02, on `c11e8aa`)

- `main.ts` registers `json({ limit: '2mb' })` and then
  `OpenApiValidator.middleware(...)` with `app.use`, ahead of Nest's routes
  (trap 3). It does not call `enableCors`, so every response is same-origin
  only.
- The validator's base path is `/api/v1` (`servers: - url: /api/v1`).
  `OpenApiContext.isManagedRoute` returns false for any path outside it, so
  metadata, request and response validation all pass such a request through
  untouched (`dist/middlewares/openapi.metadata.js`,
  `openapi.request.validator.js`: `if (!req.openapi) return next()`). The SPA
  middleware's paths are therefore never validated, wherever it is mounted.
  No `ignorePaths` is needed. Mounting it first makes that independent of the
  validator's internals, and the HTTP spec pins it.
- The validator checks `in: cookie` parameters against `req.cookies`, which
  only `cookie-parser` populates. The contract therefore describes the cookie
  in prose and declares no cookie parameter.
- Health lives at `GET /api/v1/health` (global prefix `api`, URI version 1).
  There is no top-level `/health`. The fallback still refuses `/health`, so a
  probe pointed at the wrong path gets a 404 instead of an HTML 200 that
  passes.
- Express routing is case-insensitive, so `GET /API/v1/health` reaches the
  health controller. The SPA's reserved-path check lower-cases the path.
- `POST /auth/login`, `/auth/register` (owner-first and invitation alike) and
  `/auth/password` all return `SessionTokens`. `/auth/refresh` returns them
  too. `/auth/logout` sits behind `AuthGuard`.
- `packages/client-core/src/auth.ts` maps `SessionTokens` into `StoredAuth`,
  whose `refreshToken` is `string`. Once the generated type makes the field
  optional, that mapping no longer typechecks. The CLI never sends
  `transport` and so always gets the field. `run.ts` reads
  `auth.refreshToken` only from the store.
- Vitest 5 (Oxc) emits `design:paramtypes` under the backend's
  `emitDecoratorMetadata` (checked with a scratch spec), so `NestFactory`
  resolves constructor injection inside a spec. If `createApp` fails with
  "Nest can't resolve dependencies", stop and report. Do not add a
  transformer plugin.
- Nuxt's renderer emits two scripts into the SPA's HTML
  (`packages/nuxt/src/runtime/server/renderer/payload.ts`,
  `renderPayloadJsonScript`). One is `<script type="application/json"
  id="__NUXT_DATA__">`: data, which the browser never runs and `script-src`
  does not govern. The other is an inline
  `<script>window.__NUXT__={};window.__NUXT__.config=…</script>`, which needs
  a CSP allowance. Its content is fixed when `nuxt generate` runs. No Nuxt
  option moves it into a file. Modules such as Nuxt UI's colour mode can add
  more inline scripts of the same kind.
- Express 5's `res.clearCookie` ignores `maxAge` and writes
  `Expires=Thu, 01 Jan 1970 00:00:00 GMT`. To the browser that is the same as
  `Max-Age=0`.

## Where this plan departs from the design doc and the brief

Task 6 records these in the design doc ("Departures in plan W1") and in an
ADR 0011 amendment.

1. **The cookie reaches every `/api/v1/auth/*` route, and the server reads it
   on refresh and logout.** ADR 0011 says "sent to `POST /auth/refresh` and to
   nothing else". The design doc already scopes the cookie to
   `/api/v1/auth`. Logout has to revoke the session the cookie belongs to.
   The web cannot read an `HttpOnly` cookie to copy it into the body, so with
   `Path=/api/v1/auth/refresh` a web logout would leave its session alive for
   up to 30 days. The amendment reads "sent to the auth routes; read by
   refresh and logout". *Rejected:* a second cookie for logout (two copies of
   one secret); logout through `/auth/refresh` with a flag (one route, two
   meanings).
2. **`PasswordChange` takes `transport` too, not only login and register.**
   `POST /auth/password` revokes every session, the cookie's included, and
   returns a fresh pair. Without the opt-in, a web client that changed its
   password would receive the new refresh token in a body JavaScript can
   read. ADR 0011 forbids exactly that.
3. **The CSP's script hashes are computed by the backend at startup, from
   the `index.html` it serves.** Nuxt's config script is inline, so there
   are three options: a hash, a nonce, or a config option that moves the
   script out. No such option exists. A nonce means rewriting `index.html`
   on every request. Hashes pinned in `nuxt.config` would go stale on every
   change to public runtime config. So `spa(root)` reads `index.html` once,
   hashes each executable inline `<script>` in it, and serves that same
   buffer. The policy then always matches the bytes served. This does not
   widen the XSS surface. The hashes cover only scripts present in the build
   artefact. A script injected at runtime through rendered Markdown, the
   vector ADR 0011 names, matches no hash.
4. **`style-src` allows `'unsafe-inline'`, and `script-src` allows
   `'wasm-unsafe-eval'`.** ADR 0011 requires the policy to forbid inline
   *script*, and it still does. Nuxt UI writes its theme into a runtime
   `<style>` element, and Nuxt's SPA loading template is inline CSS. Inline
   styles cannot run code. SQLite WASM (Q12) compiles WebAssembly, which a
   policy without `'wasm-unsafe-eval'` blocks. That keyword does not allow
   `eval` of JavaScript.
5. **The fallback answers only requests whose `Accept` contains
   `text/html`.** "Every path outside `/api` and `/health`" would also answer
   a missing `/_nuxt/x.js` with a 200 HTML page. A browser fetches scripts
   with `Accept: */*`, so the result is a MIME error in place of a 404, and
   a stale service worker could cache it. Navigations send `text/html`.
6. **`main.ts`'s setup moves into `createApp()`.** `main.ts` calls
   `bootstrap()` on import, so a spec cannot import it. Trap 3's comment and
   the new order comment move with the code, and `.claude/CLAUDE.md` trap 3
   points at the new file.

## Global Constraints

- **Spec first:** Task 2 lands the contract and the regenerated client
  before the backend changes, in two commits:
  `pnpm spec:validate && pnpm spec:codegen && pnpm --filter @todoer/specs build`.
- **The CLI's behaviour does not change.** `git diff main -- apps/cli` is
  empty at the end. Both e2e scripts pass untouched
  (`git diff main -- scripts/` is empty).
- **No new dependencies**, runtime or dev; `pnpm-lock.yaml` unchanged. No
  `cookie-parser`, `helmet` or `unplugin-swc`.
- **No Docker or CI changes.** The HTTP spec runs inside `Workspace tests`,
  which already has Postgres.
- **Backend tests:**
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm -w exec turbo run build typecheck test`.
  Add `pnpm lint`.
- **Every requirement has a test that failed first.** Each task names the
  mutation that turns its tests red. Revert it after checking.
- **Commits:** Conventional Commits with a scope, body says why, **no
  `Co-Authored-By` trailer**; run `pnpm format` first; never commit to
  `main`. Branch `feat/web-backend`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **The fallback swallowing what is not a page.** If `index.html` answers
   `GET /api/v1/nope`, a `POST` anywhere, or a missing hashed asset, every
   API mistake looks like success: the trap-3 class of failure. Check that
   `reserved()` lower-cases and matches `/api`, `/api/…`, `/health`,
   `/health/…`; that the method guard admits only `GET`/`HEAD`; that the
   `Accept` test is `text/html` and not `req.accepts('html')`, which
   `*/*` satisfies; and that a file at `WEB_ROOT/api/x` is not served
   (Task 5 tests 2–6).
2. **The validator or the body parser in the wrong place.** If the SPA
   middleware ends up after `json()`, nothing breaks. If `json()` ends up
   after the validator, every POST is a 400 (trap 3). The HTTP spec's
   "login reaches the controller" test (Task 3) is the first test that runs
   this chain at all. Check that it posts a well-formed body and expects
   401, not 400.
3. **The cookie's attributes.** `Secure` is unconditional. It does not depend
   on `req.secure`, and so not on `TRUST_PROXY` either. A TLS proxy therefore
   cannot strip it by forwarding plain HTTP. The cost: over
   `http://nas.local` the browser drops the cookie (Q11 says so, and the
   README must too). On `http://localhost`, Chrome and Firefox treat the
   origin as secure and keep it. Safari's handling is not verified here; see
   the task spec's open question. `Path` must equal `/api/v1/auth` in both
   `res.cookie` and `res.clearCookie`. A clear with a different path leaves
   the real cookie in place, and logout then "works" while the cookie
   survives. `SameSite=Strict` is what stops a cross-site page from
   triggering a cookie refresh. The attacker could not read the response
   anyway (no CORS), and a forced rotation only hands the victim's browser
   the successor. A *same-site* sibling (another app on `*.nas.local`) can
   send the cookie but likewise cannot read the answer. It cannot log the
   user out either, since logout needs the bearer. Check that `enableCors`
   is still absent (Tasks 4, 5).
4. **Transport selection.** On refresh, a body token wins over the cookie and
   gets a body answer. Only a cookie-sourced refresh writes `Set-Cookie`, so
   a CLI never receives one. In cookie mode, `refreshToken` must be *absent*
   from the JSON, not `undefined` or `""`. Logout must clear the cookie on
   every 204, `all: true` included. Rate limiting and the grace window must
   run through the same `sessions.refresh` call for both transports. Check
   the controller diff for a second call path (Task 4).
5. **The CLI after `refreshToken` became optional.** The generated
   `SessionTokens.refreshToken` is `string | undefined`. `httpAuthApi` must
   refuse a response without it with a `RefusalError` that names the
   problem. It must not store `undefined`, which `saveAuth` would write as
   NULL into a NOT NULL column or as the string "undefined". Check that
   `git diff main -- apps/cli` is empty and that the CLI never sends
   `transport` (Tasks 1, 2).

---

### Task 0: Commit the plan and the task spec (controller)

- [ ] `specs/tasks/active/T-2026-10-02-web-backend.md` exists (FR-001…FR-011,
      steps T001–T006). Resolve its open question with the maintainer before
      Task 6. Tasks 1–5 do not depend on the answer.
- [ ] Commit `docs(plans): plan the web client's backend side (W1)` on
      `feat/web-backend`. Body: W1 of the client-shells design. The plan
      fixes the middleware order, the cookie contract and the CSP before any
      code changes.

---

### Task 1: client-core refuses a session without a refresh token

Implements FR-009 (T001).

This lands first because it is correct under today's types too. A server
that omits the field already violates today's contract. Task 2's codegen
then typechecks without a red commit in between.

**Files:**

- Modify: `packages/client-core/src/auth.ts`, `packages/client-core/src/auth.spec.ts`

**Interfaces:** `httpAuthApi(config).login` and `.refresh` reject with
`RefusalError` when the 200 body has no string `refreshToken`. Signatures do
not change.

- [ ] **Step 0: Baseline.** On a clean tree, run the backend test command
      from Global Constraints. Write the per-package file and test counts
      into the PR description.
- [ ] **Step 1: Test.** In `auth.spec.ts`, generalise the `logoutWith`
      server helper into `serve(status, body, seen)`. It records each
      request's path and parsed JSON body. Add a
      `describe('httpAuthApi sessions')`:
  - `login` against a 200 `{ accessToken, accessExpiresAt }` rejects with a
    `RefusalError` whose message contains `no refresh token`;
  - `refresh` against the same body rejects the same way;
  - `login` sends exactly `{ email, password }` (`toEqual`, so a stray
    `transport` key fails).
- [ ] **Step 2: Code.** In `auth.ts`:

```ts
  // The CLI asks for the body transport (it never sends `transport`), so a
  // missing token means a server that does not speak this contract. Storing
  // it as undefined would leave a session that can never refresh.
  const tokens = (body: SessionTokens): StoredAuth => {
    if (typeof body.refreshToken !== 'string' || body.refreshToken === '') {
      throw new RefusalError('the server sent no refresh token');
    }
    return {
      accessToken: body.accessToken,
      accessExpiresAt: body.accessExpiresAt,
      refreshToken: body.refreshToken,
    };
  };
```

  `refreshOnce` does not retry a `RefusalError`, and `renew` throws it from
  inside `withWriteLock`, which rolls back. The stored session is left as it
  was, which is the safe outcome.
- [ ] **Step 3: Run.** Run
      `pnpm -w exec turbo run build typecheck test --filter=@todoer/cli...`.
      All green; client-core has three more tests.
- [ ] **Step 4: Mutation.** Delete the guard. The two rejection tests go red.
      Revert.
- [ ] **Step 5: Commit.** Message:
      `fix(client-core): refuse a session response without a refresh token`.
      Body: W1 makes `refreshToken` optional in `SessionTokens` for the web's
      cookie transport. The CLI always asks for the body, so an absent token
      is a contract violation, and it must fail loudly before an unusable
      session reaches the store. Tick T001.

---

### Task 2: The contract: `transport`, and an optional refresh token

Implements FR-008 (T002). Departures 1, 2.

**Files:**

- Modify: `packages/specs/openapi/openapi.yaml`
- Regenerate: `packages/specs/src/generated/*` (own commit)

**Interfaces (generated, `@todoer/specs`):**

```ts
export type SessionTokens = { accessToken: string; accessExpiresAt: string; refreshToken?: string };
export type LoginRequest = { email: string; password: string; transport?: 'body' | 'cookie' };
export type RegisterRequest = { email: string; password: string; invitation?: string; transport?: 'body' | 'cookie' };
export type PasswordChange = { currentPassword: string; newPassword: string; transport?: 'body' | 'cookie' };
export type RefreshRequest = { refreshToken?: string };
```

- [ ] **Step 1: Schemas.** Add a shared schema and reference it from the
      three requests:

```yaml
    # Where the response puts the refresh token (ADR 0011). `body`, the
    # default when absent, returns it in SessionTokens: the CLI and Flutter.
    # `cookie` sets it as an HttpOnly cookie scoped to /api/v1/auth and leaves
    # it out of the body: the web client, where no script may read it.
    TokenTransport:
      type: string
      enum: [body, cookie]
```

  `LoginRequest`, `RegisterRequest` and `PasswordChange` each gain
  `transport: { $ref: "#/components/schemas/TokenTransport" }`. Leave out
  `default:`. The validator would write the default into `req.body`, and
  "absent means body" lives in one place, the controller.
  `SessionTokens`: drop `refreshToken` from `required`, and replace its
  comment:

```yaml
        # Present when the request used the body transport; absent when the
        # refresh cookie carries it (ADR 0011). Rotates on every use: store
        # the newest.
        refreshToken: { type: string }
```

  `RefreshRequest`: drop `required`. Comment: "Absent when the refresh
  cookie carries the token. The body is still required, and may be `{}`."
- [ ] **Step 2: Routes.** Change prose only; the cookie is not declared as
      a parameter (Verified facts):
  - `/auth/login`, `/auth/register`, `/auth/password`: add to the
    description: "With `transport: cookie` the refresh token is set as the
    `todoer_refresh` cookie (`HttpOnly; Secure; SameSite=Strict;
    Path=/api/v1/auth`) and is absent from the body." Give each 200/201
    response a `headers: { Set-Cookie: { description: "the refresh cookie,
    in cookie transport only", schema: { type: string } } }`.
  - `/auth/refresh`: "Takes the refresh token from the body, or, when the
    body has none, from the `todoer_refresh` cookie. A cookie-sourced
    refresh rotates the cookie and leaves `refreshToken` out of the body. A
    body-sourced one answers in the body. Limits and the grace window are
    the same for both. No token at all is 401." Add the same `Set-Cookie`
    header.
  - `/auth/logout`: "Revokes the session of the refresh token in the body,
    or, when the body has none, in the `todoer_refresh` cookie. Every 204
    clears that cookie." Add `Set-Cookie` to the 204.
- [ ] **Step 3: Validate.** Run `pnpm spec:validate` (redocly, 0 errors).
      Commit
      `feat(specs): opt-in cookie transport for the refresh token`. Body:
      the web client keeps its refresh token where no script can read it
      (ADR 0011). The default stays the body, so the CLI's requests and
      responses are unchanged. Departures 1, 2.
- [ ] **Step 4: Codegen.** Run
      `pnpm spec:codegen && pnpm --filter @todoer/specs build`.
      `git diff --stat` lists only `packages/specs/src/generated/`. Check the
      types above in `types.gen.ts`. Then run
      `pnpm -w exec turbo run typecheck`. Everything typechecks: client-core
      through Task 1's guard (`typeof … !== 'string'` narrows), and the
      backend because it uses its own `SessionTokens` type. Commit
      `build(specs): regenerate the client for the cookie transport`. Body:
      generated output in its own commit, per the working agreement. Tick
      T002.
- [ ] **Step 5: Mutation.** Temporarily restore `refreshToken` in
      `SessionTokens.required` and regenerate. `packages/client-core`
      typechecks either way, which shows that Task 1's guard does not depend
      on the type. Task 3's HTTP spec turns this mutation into a red test
      (cookie login → 500). Revert.

---

### Task 3: `createApp()` and an HTTP spec over the real middleware chain

Implements FR-002 (T003). Departure 6.

This is a pure move plus the harness. The SPA and the cookie add tests to
this spec in Tasks 4 and 5.

**Files:**

- Create: `apps/backend/src/create-app.ts`, `apps/backend/src/create-app.spec.ts`
- Modify: `apps/backend/src/main.ts`

**Interfaces:**

```ts
/** The application with its whole HTTP chain, not yet listening. main.ts and
 *  create-app.spec.ts both build it here, so the spec runs the real order. */
export async function createApp(
  overrides?: Partial<Pick<AppConfig, 'webRoot'>>,   // `webRoot` exists from Task 5
): Promise<INestApplication>;
```

- [ ] **Step 1: Move.** `create-app.ts` takes `specPath` (same relative URL:
      `src/` and `dist/` sit at the same depth), `NestFactory.create(AppModule,
      { bodyParser: false })`, the global prefix, versioning, the filter,
      `json`, the validator and `applyTrustProxy`, with every comment
      verbatim. `main.ts` becomes:

```ts
async function bootstrap(): Promise<void> {
  const app = await createApp();
  // Without this, onApplicationShutdown (PruneService's timer teardown) only
  // ever runs in tests, never on a real SIGTERM.
  app.enableShutdownHooks();
  await app.listen(app.get(AppConfig).port);
}
```

  Keep `create-app.ts` at the top level of `src/`. `specPath` depends on it.
- [ ] **Step 2: Harness.** Add `create-app.spec.ts`:

```ts
let app: INestApplication;
let base: string;
const get = (path: string, accept = 'application/json') =>
  fetch(`${base}${path}`, { headers: { accept } });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await resetDatabase(prisma);           // a fresh owner-first instance
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => app.close());
```

  Tests (no `WEB_ROOT`):
  1. `GET /api/v1/health` → 200, `application/json`, `status: 'ok'`.
  2. `POST /api/v1/auth/login` with a well-formed body for an unknown
     address → **401** problem JSON. Trap 3: the body reached the validator
     and the controller. A 400 here means the parser runs after the
     validator.
  3. `POST /api/v1/auth/login` with `{}` → 400 from the validator, which
     shows the validator runs.
  4. `GET /` with `accept: text/html` → 404 problem JSON. Without
     `WEB_ROOT` nothing is served.
- [ ] **Step 3: Run.** Run the backend test command. The new file passes,
      and nothing else changes. Start the built server by hand
      (`PORT=3010 … node apps/backend/dist/main.js`) and run
      `curl -sf localhost:3010/api/v1/health`.
- [ ] **Step 4: Mutations.** (a) Move `app.use(json(...))` below the
      validator. Test 2 goes red (400). (b) Drop the validator. Test 3 goes
      red. Revert both.
- [ ] **Step 5: Commit.** Message:
      `test(backend): run the real middleware chain over HTTP`. Body: trap 3
      lived only in a comment. No test ran main.ts's chain, and W1 adds two
      more ordering constraints to it (design Q9). createApp() is that chain,
      shared by main.ts and the spec. Tick T003.

---

### Task 4: The refresh cookie

Implements FR-005, FR-006, FR-007 (T004). Departures 1, 2.

**Files:**

- Create: `apps/backend/src/auth/refresh-cookie.ts`, `apps/backend/src/auth/refresh-cookie.spec.ts`
- Modify: `apps/backend/src/auth/auth.controller.ts`,
  `apps/backend/src/auth/auth.controller.spec.ts`,
  `apps/backend/src/create-app.spec.ts`

**Interfaces:**

```ts
// refresh-cookie.ts
export const REFRESH_COOKIE = 'todoer_refresh';
/** Global prefix + URI version + the auth controller: the browser sends the
 *  cookie to the auth routes and nowhere else (ADR 0011, W1 amendment). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export type CookieJar = Pick<Response, 'cookie' | 'clearCookie'>;   // express
export function readRefreshCookie(header: string | undefined): string | undefined;
export function setRefreshCookie(res: CookieJar, token: string): void;
export function clearRefreshCookie(res: CookieJar): void;

// auth.controller.ts
export type Delivered = Omit<SessionTokens, 'refreshToken'> & { refreshToken?: string };
```

- [ ] **Step 1: Cookie module.**

```ts
const ATTRIBUTES = {
  httpOnly: true,
  // Unconditional, not req.secure: behind a TLS-terminating proxy the request
  // arrives as plain HTTP, and a cookie that dropped Secure there would travel
  // in clear text the moment anyone reached the backend directly.
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
} as const;

/**
 * One cookie by name. A request's Cookie header is only `name=value` pairs
 * separated by `;`, so this is the part of cookie-parser this code would use.
 * The token's alphabet (hex, digits, `-`, `.`, base64url) needs no decoding.
 * When two cookies share the name, the first wins: browsers send the
 * longest path first.
 */
export function readRefreshCookie(header: string | undefined): string | undefined {
  for (const pair of header?.split(';') ?? []) {
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq).trim() === REFRESH_COOKIE) {
      return pair.slice(eq + 1).trim() || undefined;
    }
  }
  return undefined;
}

export function setRefreshCookie(res: CookieJar, token: string): void {
  // The cookie lives as long as an idle session; each rotation extends both.
  res.cookie(REFRESH_COOKIE, token, { ...ATTRIBUTES, maxAge: IDLE_MS });
}

export function clearRefreshCookie(res: CookieJar): void {
  // Express 5 writes Expires=1970, which clears it as Max-Age=0 would. Only
  // a clear with the same Path reaches the cookie it means.
  res.clearCookie(REFRESH_COOKIE, ATTRIBUTES);
}
```

  `refresh-cookie.spec.ts` (pure, no database) covers: the value among other
  cookies; no header; another cookie only; `todoer_refresh_x=1` does not
  match; an empty value gives `undefined`; padding around `;` and `=`.
- [ ] **Step 2: Controller.** `type Client = { ip?: string; headers?: {
      cookie?: string } }`. Each changed route gains a last parameter
      `@Res({ passthrough: true }) res: CookieJar`. Without `passthrough`,
      Nest stops sending the return value.

```ts
type Transport = { transport?: 'body' | 'cookie' };

/** The pair as the request asked for it: whole in the body, or with the
 *  refresh token moved into the cookie (ADR 0011). */
function deliver(tokens: SessionTokens, cookie: boolean, res: CookieJar): Delivered {
  if (!cookie) return tokens;
  setRefreshCookie(res, tokens.refreshToken);
  const { refreshToken: _sent, ...rest } = tokens;
  return rest;
}
```

  - `login`, `register`, `changePassword`: the body type gains `& Transport`.
    Each returns `deliver(await …start(userId), body.transport === 'cookie',
    res)`. Rate limiting and the order of work do not change.
  - `refresh`:

```ts
    // The body wins: a client that sends a token wants the answer in the
    // body. Only a refresh that came from the cookie writes the cookie.
    const cookie =
      body.refreshToken === undefined
        ? readRefreshCookie(req.headers?.cookie)
        : undefined;
    try {
      const tokens = await this.sessions.refresh(body.refreshToken ?? cookie ?? '');
      return deliver(tokens, cookie !== undefined, res);
    } catch (error) { /* unchanged: a 401 counts against the IP */ }
```

    Both transports go through the one `sessions.refresh` call, so the
    limiter and the grace window are shared by construction. No token at
    all becomes `''`, which `parse` rejects as 401, counted like any
    invalid token.
  - `logout`: `clearRefreshCookie(res)` comes first, so every answer that
    gets past the guard clears it, `all: true` and a failing revoke
    included. Then `const token = body.refreshToken ??
    readRefreshCookie(req.headers?.cookie) ?? ''`, and the ownership check
    as today.
- [ ] **Step 3: Controller specs.** Add a `jar()` fake that records
      `cookie`/`clearCookie` calls. Existing calls pass `jar()` and
      `{ ip, headers: {} }`, with no assertion changed. New tests:
  - login with `transport: 'cookie'` → body has no `refreshToken` key
    (`not.toHaveProperty`). The jar got `todoer_refresh` with
    `{ httpOnly: true, secure: true, sameSite: 'strict', path: '/api/v1/auth',
    maxAge: IDLE_MS }`. The cookie's value refreshes successfully.
  - login with no `transport` and with `transport: 'body'` → `refreshToken`
    in the body, jar untouched.
  - register (owner-first) and password change with `transport: 'cookie'` →
    the same shape as login.
  - refresh from the cookie, body `{}` → new access token, no `refreshToken`
    in the body, the jar got the rotated value. The old cookie value inside
    the grace window → the jar gets the same successor again.
  - refresh with a body token *and* a cookie → body answer, jar untouched,
    and the session rotated from the body token.
  - refresh with neither → 401, and it counts toward the IP limit. 30
    invalid **cookie** refreshes → the 31st is a 429 (mirrors "blocks an IP
    after thirty invalid refreshes").
  - logout with the cookie only → that session revoked, the cookie cleared.
    `all: true` → cleared. Another user's token in the cookie → not revoked,
    still cleared.
- [ ] **Step 4: HTTP tests.** Add to `create-app.spec.ts`, using
      `response.headers.getSetCookie()`:
  5. Register the owner with `transport: 'cookie'` → 201, no
     `refreshToken` in the JSON, and a `Set-Cookie` of the form
     `todoer_refresh=…; Max-Age=2592000; Path=/api/v1/auth; Expires=…;
     HttpOnly; Secure; SameSite=Strict`. Assert each attribute, not the
     order. This proves the validator accepts `transport` and the response
     validator accepts the missing token.
  6. `POST /api/v1/auth/refresh` with body `{}` and
     `cookie: todoer_refresh=<value>` → 200, a new `Set-Cookie`, no
     `refreshToken`.
  7. `POST /api/v1/auth/logout` with the bearer from 6, body `{}`, and the
     cookie → 204, `Set-Cookie` with `Path=/api/v1/auth` and an `Expires`
     in 1970. A refresh with the old cookie afterwards → 401.
- [ ] **Step 5: Run.** Backend suite and `pnpm lint`.
- [ ] **Step 6: Mutations.** Each turns a named test red; revert each:
  - drop `passthrough: true` on refresh → HTTP test 6 times out;
  - `cookie !== undefined` → `true` in refresh's `deliver` → "body token
    and cookie" goes red;
  - move `clearRefreshCookie` after the `all` return → logout `all: true`
    goes red;
  - clear with `path: '/'` → HTTP test 7 goes red;
  - restore `refreshToken` in `SessionTokens.required` (Task 2, Step 5) →
    HTTP test 5 answers 500.
- [ ] **Step 7: Commit.** Message:
      `feat(auth): carry the refresh token in an HttpOnly cookie on request`.
      Body: the web client may not hold its refresh token where scripts can
      read it (ADR 0011). The cookie is opt-in per request, so the CLI is
      untouched. Logout reads it too, which the ADR amendment in this PR
      records. Tick T004.

---

### Task 5: Serve the SPA: static files, fallback, CSP, cache

Implements FR-001, FR-002, FR-003, FR-004 (T005). Departures 3, 4, 5.

**Files:**

- Create: `apps/backend/src/web/spa.ts`, `apps/backend/src/web/spa.spec.ts`
- Modify: `apps/backend/src/config/app-config.ts`,
  `apps/backend/src/config/app-config.spec.ts`,
  `apps/backend/src/create-app.ts`, `apps/backend/src/create-app.spec.ts`

**Interfaces:**

```ts
// app-config.ts
readonly webRoot: string | undefined;   // absolute; WEB_ROOT unset → undefined

// web/spa.ts
export function inlineScriptHashes(html: string): string[];   // "'sha256-…'" each
export function contentSecurityPolicy(html: string): string;
export function spa(root: string): RequestHandler;
```

- [ ] **Step 1: Config.** `readonly webRoot = this.spaRoot('WEB_ROOT')`:
      unset or blank → `undefined`. Otherwise `path.resolve` it, and throw
      `WEB_ROOT must be a directory holding index.html, not <raw>` unless
      `existsSync(join(root, 'index.html'))`. The reason is `PORT`'s: a typo
      should stop the process at startup. It should not produce a server
      that answers every page with 404. `app-config.spec`: unset; a temp dir
      with `index.html` → its absolute path; a relative path → resolved;
      a missing dir and a dir without `index.html` → both throw.
- [ ] **Step 2: Policy (pure).**

```ts
// A <script> runs when it has no type, `module`, or a JavaScript MIME type.
// Nuxt's __NUXT_DATA__ payload is `application/json`: data, not script.
const EXECUTABLE = /^(?:module|(?:text|application)\/(?:java|ecma)script)?$/i;

/** CSP hashes of the inline scripts the build put into index.html. The
 *  browser hashes the exact text between the tags, which is what is hashed
 *  here. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, attrs = '', body = ''] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (/\bsrc\s*=/i.test(attrs) || body === '') continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? '';
    if (!EXECUTABLE.test(type)) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

/**
 * ADR 0011: no inline script runs except the build's own, by hash (plan
 * departure 3). 'wasm-unsafe-eval' lets SQLite WASM compile (design Q12) and
 * allows no JavaScript eval. Inline style stays allowed: Nuxt UI writes its
 * theme into a <style> element at runtime, and CSS cannot run code
 * (departure 4). connect-src falls back to 'self': the API is same-origin
 * (Q9), so nothing else needs reaching.
 */
export function contentSecurityPolicy(html: string): string {
  return [
    "default-src 'self'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...inlineScriptHashes(html)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
```

  `spa.spec.ts` covers `inlineScriptHashes`. A Nuxt-shaped fixture (the
  `__NUXT_DATA__` JSON script, the `window.__NUXT__` config script, and
  `<script type="module" src="/_nuxt/entry.js">`) gives exactly one hash,
  equal to `createHash('sha256').update('window.__NUXT__={};…')` computed in
  the test. `type="text/javascript"` and `type=module` without quotes are
  hashed. An empty inline script is skipped. Two inline scripts give two
  hashes, in document order. Check that `contentSecurityPolicy` contains no
  `'unsafe-inline'` inside `script-src`.
- [ ] **Step 3: Middleware.**

```ts
/** Never the SPA's, whatever WEB_ROOT holds (design Q9). Lower-cased because
 *  Express routing is case-insensitive: /API/v1/health reaches Nest. */
const reserved = (path: string): boolean => {
  const p = path.toLowerCase();
  return ['/api', '/health'].some((r) => p === r || p.startsWith(`${r}/`));
};

/** Nuxt puts every content-hashed file under buildAssetsDir (`/_nuxt/`). */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Everything else (index.html, sw.js, the manifest) must be revalidated, or
 *  a client keeps an old app after an update. */
const REVALIDATE = 'no-cache';

export function spa(root: string): RequestHandler {
  // Read once: the policy's hashes always describe the bytes served. A new
  // build means a new image, so a restart.
  const index = readFileSync(join(root, 'index.html'));
  const csp = contentSecurityPolicy(index.toString('utf8'));
  const hashed = join(root, '_nuxt') + sep;
  const files = express.static(root, {
    index: false,      // `/` goes to the fallback, with its headers
    redirect: false,   // no /dir → /dir/ redirect ahead of the fallback
    cacheControl: false,
    setHeaders: (res, path) => {
      // Workers take their policy from their own script's response, so every
      // file carries it, not only the document.
      res.setHeader('Content-Security-Policy', csp);
      res.setHeader('Cache-Control', path.startsWith(hashed) ? IMMUTABLE : REVALIDATE);
    },
  });
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || reserved(req.path)) {
      return next();
    }
    files(req, res, (error?: unknown) => {
      if (error !== undefined) return next(error);
      // Only a navigation gets the app. A missing script or image asks for
      // */*, which req.accepts('html') would also accept, and must get its 404
      // (plan departure 5).
      if (!(req.headers.accept ?? '').includes('text/html')) return next();
      res
        .set({ 'Content-Security-Policy': csp, 'Cache-Control': REVALIDATE })
        .type('html')
        .send(index);
    });
  };
}
```

- [ ] **Step 4: Mount.** In `createApp`, after the filter and *before*
      `json()`:

```ts
  // Order matters, as with the body parser below (trap 3). The SPA comes
  // first and passes on everything under /api and /health, every non-GET,
  // and every non-navigation it has no file for. The validator only ever
  // manages /api/v1 (its base path), so static paths are never validated.
  // create-app.spec.ts pins all of it.
  const webRoot = overrides.webRoot ?? config.webRoot;
  if (webRoot !== undefined) app.use(spa(webRoot));
```

- [ ] **Step 5: HTTP tests.** Add a second `describe` in `create-app.spec.ts`
      with its own app on `createApp({ webRoot })`. `webRoot` is a temp dir
      with an `index.html` holding a config-style inline script,
      `_nuxt/app.abc123.js`, `sw.js`, and `api/secret.txt`.
  1. `GET /` with `accept: text/html` → 200 `text/html`, the body equals
     the fixture, `Cache-Control: no-cache`, and the CSP contains the
     fixture script's hash and `'wasm-unsafe-eval'`.
  2. `GET /tasks/123` (html) → the same document. `HEAD /tasks/123` → 200,
     no body.
  3. `GET /api/v1/health` (html) → JSON health. `GET /API/v1/nope` (html)
     → 404 problem JSON. `GET /api` and `GET /health` (html) → 404, not
     HTML.
  4. `GET /api/secret.txt` → 404 problem JSON; the file is not served.
  5. `POST /tasks` (html) → 404 problem JSON.
  6. `GET /_nuxt/missing.js` with `accept: */*` → 404, not HTML.
  7. `GET /_nuxt/app.abc123.js` → 200 JavaScript,
     `Cache-Control: public, max-age=31536000, immutable`, CSP present.
     `GET /sw.js` → `no-cache`.
  8. Trap 3 with the SPA mounted: `POST /api/v1/auth/login` with a
     well-formed body → 401.
  9. No `access-control-allow-origin` header on any response above.
- [ ] **Step 6: Run.** Backend suite and `pnpm lint`. Then a manual smoke
      test, if a browser is at hand: point `WEB_ROOT` at a temp dir whose
      `index.html` holds `<script>document.title='ok'</script>`, start the
      server, and open `/anything`. The title becomes `ok` and the console
      shows no CSP violation.
- [ ] **Step 7: Mutations.** Each turns a named test red; revert each:
  - drop `reserved(...)` → HTTP 3 and 4 go red;
  - replace the `Accept` check with `req.accepts('html')` → HTTP 6 goes red;
  - drop the method guard → HTTP 5 goes red;
  - mount `spa` after the validator: nothing goes red. Record this in the
    PR: the base path keeps them apart, so the order between those two is
    not load-bearing. The order between `json()` and the validator is, and
    HTTP 8 still guards it;
  - drop `EXECUTABLE`'s check → the `__NUXT_DATA__` fixture gives two
    hashes;
  - give the `_nuxt` test a `startsWith(root)` instead of `hashed` → HTTP 7's
    `sw.js` becomes immutable.
- [ ] **Step 8: Commit.** Message:
      `feat(backend): serve a built SPA from WEB_ROOT on the API's origin`.
      Body: design Q9. One origin makes the refresh cookie a plain
      SameSite=Strict cookie. The fallback never shadows /api or /health and
      answers only page navigations. ADR 0011's CSP comes from the served
      index.html's own inline scripts (departures 3–5). Tick T005.

---

### Task 6: Docs, the ADR amendment, and the full proof

Implements FR-010, FR-011 (T006).

**Files:** `docs/adr/0011-bearer-everywhere-cookie-only-for-refresh.md`,
`README.md`, `docs/specs/2026-09-25-domain-and-sync-design.md`,
`docs/specs/2026-10-01-client-shells-design.md`, `.claude/CLAUDE.md`.

- [ ] **Step 1: ADR 0011.** Append
      `## Amendment (2026-10-02, plan W1): the cookie's path and opt-in`.
      Content: the cookie is `todoer_refresh`, `HttpOnly; Secure;
      SameSite=Strict; Path=/api/v1/auth`, Max-Age 30 days, renewed on every
      rotation. The browser sends it to the auth routes, and the server
      reads it on refresh and logout, because logout must revoke the
      session of a token the web cannot read (departure 1). A client opts
      in with `transport: cookie` on login, register and password change;
      the default is the body. A refresh answers in the transport its token
      came from. The amendment also replaces the last sentence of the plan D
      amendment ("until then … body only") with a pointer to this one.
      Leave the Decision paragraph as written: the ADR is a record, and the
      amendment is how it changes.
- [ ] **Step 2: README.**
  - "What works today", the `/api/v1/auth/*` bullet: add "the refresh token
    in the body, or, for the web client, in an `HttpOnly` cookie
    (`transport: cookie`)". Add a bullet: the backend serves a built web
    client from `WEB_ROOT` on the API's origin (the web client itself is W2).
  - Environment table: `WEB_ROOT` | backend | unset | "a built SPA to serve
    on the API's origin; must hold `index.html`; unset serves nothing".
  - A new subsection, `### Serving the web client`. Content: what
    `WEB_ROOT` does. Then the HTTPS requirement: the refresh cookie is
    `Secure`, and service workers and OPFS need a secure context. Over
    plain `http://nas.local` the web client cannot sign in; `localhost` is
    the exception. TLS comes from the operator's reverse proxy (Q11), with
    a three-line Caddy example
    (`todo.example.test { reverse_proxy localhost:3000 }`), a pointer to
    `TRUST_PROXY` (the existing paragraph moves here), and one sentence on
    `tailscale serve` for reaching it without opening ports.
- [ ] **Step 3: Domain design §5.** `POST /auth/refresh` → "the token from
      the body, or the web's cookie". `POST /auth/logout` → "revoke the
      body's or the cookie's session, or every session; clears the cookie".
- [ ] **Step 4: Client-shells design.** Append "## Departures in plan W1",
      one paragraph per departure 1–6 above. Add two W2 notes: the CSP list
      from the task spec's "W2 must", and the Safari open question if it is
      still open.
- [ ] **Step 5: `.claude/CLAUDE.md`.** Trap 3: "`main.ts` does this
      deliberately" → "`create-app.ts` does this deliberately, and
      `create-app.spec.ts` pins it over HTTP; the SPA middleware sits ahead
      of both." The stack table's `apps/backend` row: add "serves the built
      SPA from `WEB_ROOT`".
- [ ] **Step 6: Stale-claim sweep.**

```sh
rg -n "nothing else|body only|cookie arrives|cookie transport.*lands|main\.ts does" \
  README.md docs .claude packages/specs/openapi
```

  Every hit is either updated or a historical record (plans, the plan D
  design's departure 2) that stays as written.
- [ ] **Step 7: Gates and e2e.** Run the backend test command, then
      `pnpm lint`, then both e2e scripts against a fresh `todoer_e2e`
      database, as in plan W0 Task 6 Step 5. Run them once without
      `WEB_ROOT`, and once with `WEB_ROOT` pointing at a temp dir holding an
      `index.html`: the scripts must not notice the SPA. Then check that
      `git diff main -- apps/cli scripts/ pnpm-lock.yaml` is empty.
- [ ] **Step 8: Commit.** Message:
      `docs: the refresh cookie, WEB_ROOT and plan W1's departures`. Body:
      ADR 0011 said the cookie went to refresh alone and arrived "with the
      web client". Both stopped being true. Tick T006. Move the task spec to
      `done/` per `specs/tasks/README.md`. Add the dnote changelog line.

---

## What this plan does not do

- No Dockerfile and no image (W2 builds the SPA that would go in it).
- No `apps/web`, no Nuxt config. The CSP requirements are handed to W2 in
  the task spec.
- No clearing of the cookie on a refresh 401. The SPA treats 401 as signed
  out, and the next login overwrites the cookie. Add it if a dead cookie
  ever causes a visible problem.
- No `__Secure-`/`__Host-` cookie prefix. `__Host-` requires `Path=/`, which
  would send the token on every request. `__Secure-` adds nothing over the
  `Secure` attribute here, and its treatment on `http://localhost` varies
  across browsers.
- No `X-Content-Type-Options`, HSTS or other hardening headers. HSTS belongs
  to the TLS terminator, which is the operator's proxy (Q11).
- No CSRF token. `SameSite=Strict`, no CORS and a bearer-guarded logout
  leave nothing for one to protect (Review Focus 3).
