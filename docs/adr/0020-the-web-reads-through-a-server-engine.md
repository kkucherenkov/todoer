# 20. The web reads through a server engine

- **Status:** accepted
- **Date:** 2026-10-23

## Context

The web kept a full replica in the browser: SQLite WASM on OPFS, a leader tab
elected through Web Locks, a dedicated worker. That buys offline use, and the
web never gets any: it is served from the maintainer's NAS, so without the
network the page does not load. What it costs showed on 2026-10-23, when
Firefox answered the OPFS install with `UnknownError` and the page stopped at
"The local database did not start"; the only recovery was clearing the site's
data by hand. The maintainer uses the web to look at tasks, add one and mark
one done. Local-first stays where it pays: the CLI, the TUI and the future
mobile app.

## Decision

The backend runs `createEngine` from client-core, one engine per signed-in
user, on an in-memory `node:sqlite` replica; its transport calls
`SyncService.sync` in process, so every invariant of `POST /sync` applies to
the web's writes. The page keeps the engine protocol it speaks today,
`Command` → `Result` and topics, over `POST /engine` and a server-sent event
stream per tab. `/sync` stays the only write path into the database; `/engine`
is the web's way in, and it reads through client-core.

This amends [ADR 0012](0012-no-rest-surface.md): there is still no REST
surface of per-view queries. Design:
[`docs/specs/2026-10-23-web-thin-client-design.md`](../specs/2026-10-23-web-thin-client-design.md).

## Consequences

There is no second read path: views still come from client-core, computed once
for the TUI and the web.

The web has no offline mode. Losing the connection disables its write controls
until the stream is back; nothing is queued in the browser.

One backend process holds the engines in memory. The design assumes a single
process, as the NAS runs it; a second one would need the change feed to cross
processes.
