# 11. Bearer for data, a cookie only for refresh

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Three clients need sessions. A browser can hold a token in `localStorage`,
where any script that executes on the page can read it, or in an `HttpOnly`
cookie, where none can. The notes field renders Markdown, so script execution
from the application's own data is a real vector rather than a hypothetical.

## Decision

Every data request on every client authenticates with `Authorization: Bearer`.
The only cookie in the system is `HttpOnly`, `Secure`, `SameSite=Strict`,
carries the refresh token, is sent to `POST /auth/refresh` and to nothing else,
and exists only on the web. Flutter keeps its refresh token in secure storage
and the CLI in a file with mode 0600; both send it in the request body.

## Consequences

The middle position — access token in memory, refresh token in `localStorage` —
protects nothing worth protecting. Stealing a refresh token *is* account
takeover, and a persistent one. The real choice is binary: the refresh token is
reachable by JavaScript or it is not.

Every property that made bearer attractive survives, because the cookie
authenticates nothing. It delivers one string to one endpoint. There is still
one security scheme in the contract, no CSRF surface on data, and one
authentication path in three clients.

The price is one asymmetry: `/auth/refresh` accepts its token from a cookie or
from the body. It is contained to that endpoint, and `SameSite=Strict` closes
CSRF on it without a separate token.

Two requirements follow and are not optional: Markdown renders without raw
HTML, and the content security policy forbids inline script.

## Amendment (2026-10-01, plan D): refresh rotation

A refresh token is derived per (session, generation): `<sessionId>.<generation>.<mac>`,
with the mac an HMAC of the pair and a per-session salt under the server secret.
No refresh token or token hash is stored. Every refresh rotates it, and presenting
a spent token is reuse detection: the session is revoked. A 30-second grace
window softens that: within it the spent token returns the same successor
refresh token, with a freshly minted access token, so a lost response is
retryable. The cookie transport described above arrived with plan W1; see the
next amendment.

## Amendment (2026-10-02, plan W1): the cookie's path and opt-in

The cookie is `todoer_refresh`, `HttpOnly; Secure; SameSite=Strict;
Path=/api/v1/auth`, with a Max-Age of 30 days, renewed on every rotation. The
browser sends it to every auth route, not to `/auth/refresh` alone, and the
server reads it on refresh and on logout. Logout has to revoke the session of
a token the web cannot read: an `HttpOnly` cookie cannot be copied into a
body, so with a path of `/auth/refresh` a web logout would leave its session
alive for up to 30 days. A second cookie for logout would be two copies of one
secret, and logout through `/auth/refresh` with a flag would give one route
two meanings. This replaces the Decision's "sent to `POST /auth/refresh` and to nothing
else" and the Consequences' "contained to that endpoint": the asymmetry now
spans refresh and logout.

A client opts in with `transport: cookie` on login, register and password
change. The default is the body, so the CLI and every script are unchanged.
Password change takes the field too: it revokes every session and returns a
fresh pair, and without the opt-in a web client would receive the new refresh
token in a body its scripts can read. A refresh answers in the transport its
token came from. A token in the body wins over the cookie and gets a body
answer with no `Set-Cookie`. A cookie-sourced refresh rotates the cookie and
leaves `refreshToken` out of the JSON. Every logout 204 clears the cookie with
the same path.

Three properties of the cookie follow from this and are deliberate:

- **Max-Age is fixed at the 30-day idle limit.** Near the 365-day absolute
  limit the cookie can outlive its session by up to 30 days. The server stays
  authoritative: it answers 401, and the client treats that as signed out.
- **A duplicated `todoer_refresh` cookie reads as absent.** A same-site
  sibling (another app on `*.nas.local`) can plant a second cookie of the same
  name, and which copy the browser lists first is not the app's to choose.
  Refusing both is the defence against that cookie tossing.
- **A refused cookie refresh clears the cookie**, so a dead or tossed value
  does not come back on every request. A refused body refresh sets nothing.
