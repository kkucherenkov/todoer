# Plan D: authentication — sessions, refresh, accounts

Plan A stopped at `register` and `login` with a stateless 15-minute access
token: there is no refresh, no logout, no revocation, registration is open to
anyone, and the CLI's callers must mint tokens with curl. This document settles
the rest of the auth surface as **one plan**. Sessions become server-side rows
holding a **rotating refresh token** with reuse detection, softened by a short
server grace window and a client-side lock so a lost response or two parallel
CLI runs are not mistaken for theft. The CLI gains `todoer login`/`logout`
(password grant, tokens kept in its SQLite, refreshed automatically); the
device-code flow waits for the web client. Accounts follow ADR 0014: the first
account is the owner, later ones need a single-use invitation, password reset
works without SMTP (owner resets others; a host command for the owner), account
deletion needs the password, and login is rate-limited in memory.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **access token** | The short-lived bearer token every data request carries (15 minutes, HMAC-signed, ADR 0011). | session token, JWT |
| **refresh token** | A long-lived secret exchanged at `POST /auth/refresh` for a new access token and a new refresh token; a cookie on the web, the request body elsewhere (ADR 0011). | remember-me token |
| **session** | The server row for one sign-in of one device: the current refresh token's hash, its predecessor's hash, and its time limits. Logout and revocation act on it. | login, connection |
| **rotation** | Every refresh returns a new refresh token and spends the old one. | renewal |
| **reuse detection** | Presenting an already-spent refresh token (outside the grace window) revokes the whole session. | replay check |
| **grace window** | A short period after rotation during which the just-spent token still returns the same successor refresh token with a freshly minted access token, instead of triggering reuse detection. | leeway |
| **owner** | The first account on an instance; issues invitations and resets other users' passwords (ADR 0014). | admin, root |
| **invitation** | A single-use token the owner issues for registering one new user. | invite code, signup link |

## Why

A web client cannot ship on a token that logs the user out every 15 minutes
with no way to renew, and an instance reachable from the internet cannot keep
registration open to anyone. The CLI is meant for scripts and agents
(ADR 0015) but today tells them to fetch tokens by hand. ADR 0011 and ADR 0014
already decide where tokens live and who may register; what they leave open is
the session lifecycle, how the CLI signs in, and the account details.

## Locked decisions

### Refresh tokens rotate, with reuse detection (Q2)

**Decision.** A `session` table holds, per sign-in: user id, the hash of the
current refresh token, the hash of the previous one and when it was rotated,
`lastUsedAt`, `createdAt`, and a revoked flag. Each `POST /auth/refresh`
verifies the presented token against the current hash, issues a new access
token and a new refresh token, and moves the current hash to "previous".
Presenting a spent token outside the grace window (next decision) revokes the
session. Refresh tokens are random (≥ 256 bits) and stored only as hashes.

**Rejected.**

- *Long-lived, unrotated refresh tokens.* A stolen token works until expiry and
  nothing reveals the theft.
- *Sliding access tokens with no refresh token.* Every request becomes a write,
  and revocation still needs server state.

**Cost.** A table and a write per refresh; access tokens stay stateless, so a
revoked session's access token lives until it expires (≤ 15 minutes).

### A grace window on the server and a lock in the client (Q4)

**Decision.** For ~30 seconds after a rotation, presenting the just-spent token
returns the same successor refresh token the first presentation got, with a
freshly minted access token, not a revocation. The CLI additionally serialises its refreshes in a transaction
on its SQLite store, so two parallel invocations do not both refresh.

- A lost refresh response is ordinary for a CLI; only a server-side window lets
  the retry succeed.
- Parallel agent runs are cheaper to stop at the client than to absorb on the
  server, and the store already gives transactions.

**Rejected.**

- *Client lock only.* Does not help a lost response.
- *Server window only.* Every parallel run spends a request and widens the
  window a thief can use.

**Cost.** During the window a stolen spent token also gets the pair; the window
is short and tied to the session.

### Lifetimes: 15 minutes, 30 days sliding, 1 year absolute (Q5)

**Decision.** Access tokens live 15 minutes. A session expires after 30 days
without a refresh (each rotation extends it) and in any case one year after
sign-in.

**Rejected.** *A fixed 90 days* logs out active users for no reason; *access 1
hour with a refresh that never expires* makes a stolen token permanent.

**Cost.** Two timestamps per session, both checked on refresh.

### The CLI signs in with a password; device flow waits for the web (Q3, Q6, Q13)

**Decision.** `todoer login <email>` reads the password from
`TODOER_PASSWORD`, or from stdin (no echo when it is a terminal), calls
`POST /auth/login`, and stores the access token, refresh token and session
expiry in a table of its SQLite store (`todoer.db`, mode 0600). Every command
refreshes the access token itself — ahead of time when it expires within a
minute, and once on a 401 — inside the store's transaction. `TODOER_TOKEN`
still overrides the stored pair for scripts that bring their own token.
`todoer logout [--all]` revokes and clears it. Resetting the replica (after a
`410`) never touches the token table.

- Scripts and agents can be handed a password in the environment; they cannot
  click through a browser approval.
- The SQLite transaction is the client-side refresh lock.

**Rejected.**

- *Device flow now with a backend-served approval page.* A UI the server would
  own forever.
- *Device flow approved from another CLI.* Requires an already signed-in CLI.
- *A separate credentials file or the OS keyring.* A second secret file, and no
  keyring in headless agent environments.
- *`--password` on the command line.* Visible in `ps` and shell history.

**Cost.** The password passes through the CLI process. The device-code flow
remains promised for when the web client exists (Deferred).

### Invitations are single-use, expire in 7 days, optionally bound to an address (Q7)

**Decision.** `POST /auth/invites` (owner only) returns a random token, stored
as a hash, valid once and for 7 days, optionally bound to an email (then only
that address may register with it). `POST /auth/register` succeeds without an
invitation only when the instance has no users; that first account becomes the
owner. On an existing instance, the migration marks the earliest-created user
as the owner.

**Rejected.** *A reusable link until revoked* opens unbounded accounts if
leaked; *mandatory email binding* requires knowing the address upfront.

**Cost.** The owner issues one invitation per new user.

### No SMTP in this plan (Q8)

**Decision.** `POST /auth/forgot` answers plainly that mail is not configured.
Recovery: the owner resets another user's password
(`POST /auth/users/{id}/password`, owner only); the owner's own password is
recovered on the host (next decision). SMTP is a separate task.

**Rejected.** *SMTP through nodemailer* adds a dependency and configuration
that need their own decision; *a home-made SMTP client* re-implements TLS,
authentication and retries.

**Cost.** A user who forgets their password waits for the owner.

### Owner self-recovery is a host script that prints a one-time code (Q10)

**Decision.** `pnpm --filter @todoer/backend run owner:reset-password` (reads
`DATABASE_URL`) prints a one-time reset code valid for 15 minutes; the new
password is set through `POST /auth/reset` with that code — the same path, the
same password check and the same revocation of all sessions as any reset.

**Rejected.** *Setting the password directly from the script* puts it in shell
history and process arguments; *a startup environment variable* opens reset to
anyone who can reach the server meanwhile.

**Cost.** Two steps for a rare emergency.

### Account deletion needs the password; the owner cannot leave others behind (Q9)

**Decision.** `DELETE /auth/account` requires the current password in the body
and purges the user and everything they own (no tombstones — no replica is
left to tell). The owner cannot delete their account while other users exist.

**Rejected.** *Bearer token only* makes an irreversible action one stolen token
away; *automatic transfer of the owner role* makes someone an administrator
without their consent.

**Cost.** Ownership transfer does not exist yet; an owner with other users must
delete them first (Deferred).

### Login is rate-limited in memory (Q12)

**Decision.** Failed logins are counted per address and per client IP over a
sliding window; past a threshold the server answers `429` with `Retry-After`.
Refresh with an invalid token is counted per IP the same way. No new
dependency; counters live in process memory.

**Rejected.** *Leaving it to a reverse proxy* — a self-hoster may run none;
*counters in the database* — a write per failed attempt, worth it only with
several instances.

**Cost.** A restart clears the counters, and several processes would each keep
their own; recorded as a known limit.

## Departures in the plan

The implementation plan ([plan D](../plans/2026-10-01-plan-d-auth.md)) departs
from this document in five places.

1. **Refresh tokens are derived, not stored.** Instead of hashes, a token is
   `<sessionId>.<generation>.<mac>` with an HMAC under `JWT_SECRET` and a
   per-session salt. The server stores only the generation, so it recomputes
   the exact successor a grace-window retry must receive without keeping a
   plaintext token for 30 s.
2. **No refresh cookie yet.** The routes take the refresh token in the body
   only; the cookie transport lands with the web client.
3. **The owner's reset of another user sets the password directly**
   (`POST /auth/users/{id}/password` with `{ password }`) and revokes that
   user's sessions; reset codes exist only for the host script.
4. **`POST /auth/password` returns a fresh pair** after revoking every session,
   so the client that changed the password stays signed in.
5. **The e2e scripts share a helper** (`scripts/lib/fresh-user.sh`) that signs
   in as the owner, invites and registers a fresh user, because owner-first
   registration refuses their second run.

## Routine choices

- **One plan, not two (Q1).** Rejected by the maintainer: sessions and accounts
  ship together. The plan still orders the work sessions-first.
- **Logout and revocation (Q11).** `POST /auth/logout` revokes the current
  session; `{ "all": true }` revokes every session of the user; a password
  reset or change revokes every session. A password change route
  (`POST /auth/password`, current and new password) is part of the plan so
  that "change" exists beside "reset". No session listing yet.
- **Password rules (Q14).** At least 8 characters with letters, digits and
  symbols, one check shared by register, reset and change. Chosen by the
  maintainer over the recommended 12-character length-only rule. Existing
  passwords are not re-checked.
- **Generic errors stay generic.** Every new auth failure answers with the
  existing undistinguishable messages; the timing equalisation in `login`
  extends to invitation and reset-code checks.

## Verified facts

- `apps/backend/src/auth/auth.service.ts`: access tokens are
  `base64url(payload).HMAC-SHA256`, `exp` 15 minutes, no storage; passwords are
  scrypt with a random salt; `login` equalises timing for unknown addresses.
- `apps/backend/src/auth/auth.controller.ts`: open `POST /auth/register` (no
  owner or invitation gate) and `POST /auth/login`; nothing else.
- The CLI authenticates only through `TODOER_TOKEN`; its store is
  `~/.config/todoer/todoer.db`, created with mode 0600.
- ADR 0011 (bearer everywhere, refresh cookie only on the web) and ADR 0014
  (owner-first, two-path reset) are accepted; the domain design §5 lists the
  routes this plan builds.

## Risks

- **The grace window is a window.** A thief presenting a spent token within
  ~30 s of its rotation gets the successor refresh token. Mitigation: short window, bound to the
  session, and the next legitimate refresh then trips reuse detection.
- **In-memory rate limits** reset on restart and do not add up across
  processes.
- **Password in the CLI's environment.** `TODOER_PASSWORD` is readable by
  anything that can read the agent's environment; `todoer login` stores tokens,
  not the password, so the variable is needed only once.
- **Owner lock-in.** Without ownership transfer, an owner of a shared instance
  cannot delete their account.
- **Migration picks the earliest user as owner** — on an instance where that is
  the wrong person, the operator must fix it in the database.

## Deferred

- **Device-code flow for the CLI** — reopens when the web client exists to
  approve codes.
- **SMTP for `forgot`** — a separate task with its own dependency decision.
- **Ownership transfer** — reopens when an instance has a second user who should
  take over.
- **Session listing and per-session revocation** (`GET /auth/sessions`).

## Open threads

None.
