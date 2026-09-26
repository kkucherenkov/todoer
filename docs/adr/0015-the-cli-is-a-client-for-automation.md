# 15. The CLI is a client for automation and agents

- **Status:** accepted
- **Date:** 2026-09-25

## Context

A command-line tool for a self-hosted product is easily mistaken for an
administrative utility that runs beside the server. This one is not that. It is
a first-class client, alongside the web and Flutter applications, and its
primary callers are scripts and agents rather than a person at a prompt.

## Decision

The CLI is a network client with no privileged access. It runs anywhere it can
reach the instance, authenticates exactly as the other clients do, and is
designed for non-interactive use first.

Four requirements follow, and none of them is optional:

1. **Machine-readable output.** Every command supports `--json` with a
   documented, stable shape. Human-facing formatting is the convenience layer,
   not the contract.
2. **Meaningful exit codes.** Distinct codes for a refusal, a conflict, a
   network failure and a usage error, so a caller can branch without parsing
   text.
3. **Non-interactive authentication.** A token from the environment is a
   supported first-class path, not a fallback; the device-code flow is for a
   person setting the tool up.
4. **Retry-safe writes.** An operation id is generated once, persisted with the
   queued operation, and **reused on every retry** of that same intent.

## Consequences

The fourth requirement is the one that would otherwise be missed. An agent
retries on failure — that is its normal mode, not an exception. If a retried
`add` mints a fresh operation id, the server correctly treats it as a new
intent and the task is created twice. The idempotency of
[0005](0005-client-generated-identifiers.md) only works if the client stops
generating new ids for the same intent, which makes the outbox entry, not the
invocation, the unit of identity.

The CLI is therefore not a thinner client than the others. It needs the same
local store and the same outbox, and it gets them first, because it is the
cheapest surface on which to prove the synchronisation loop end to end.

Treating it as an administrative tool would also have given it a database
connection, and with it a second write path that bypasses every rule in
[0004](0004-field-level-last-write-wins.md) and
[0013](0013-tombstones-and-the-retention-contract.md). Server-side
administration is a separate command with a separate name.

## Update, 2026-09-26: the outbox

Requirement 4 is met. The CLI keeps a SQLite replica and outbox at
`$HOME/.config/todoer/todoer.db`; every operation is stored before it is
sent and keeps its id on every attempt. Every command sends the outbox first.

Two additions to the contract of requirements 1 and 2:

- **Exit 5** means the server was not reached — no connection, a timeout, a
  5xx: the answer is local and the command's operation is queued. It is not a
  failure and must not be retried; the next command that reaches the server
  delivers the operation. Exit 3 no longer describes a network condition; it
  is an unexpected local failure.
- **The `--json` envelope**: every command that exits 0 or 5 prints
  `{"data": …, "synced": bool, "outbox": {"pending": n, "failed": n}}`; on
  1–4 stdout is empty and the reason is on stderr.
  `synced` is false exactly when the command exits 5. `outbox.failed` counts
  operations the server refused after the command that queued them had exited;
  `todoer outbox` lists them and `todoer outbox drop` forgets them.
