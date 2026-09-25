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
