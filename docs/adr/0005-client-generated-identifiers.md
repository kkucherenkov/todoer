# 5. Clients generate UUIDv7 identifiers

- **Status:** accepted
- **Date:** 2026-09-25

## Context

An object created offline needs an identifier immediately: subtasks, tags and
edits in the same outbox reference it before any server has seen it.

## Decision

Clients generate UUIDv7 identifiers and the server accepts them. There is no
temporary-id mapping.

## Consequences

Todoist's `temp_id` is documented as "a placeholder ID for resources created
within the same request batch". That solves dependent commands inside one HTTP
request; it does not solve an outbox that spans days. The alternative to client
ids is therefore a client-side mapping table plus rewriting references in the
queue every time the server answers — and a class of defect where a reference
points at a temporary id that has already been rewritten.

UUIDv7 rather than v4 because it sorts by creation time, which makes indexes
behave and makes a log of ids readable.

Accepting a client-supplied identifier is safe here only because users are
isolated: an id has to be unique within one owner, and there is nowhere to
smuggle another person's id to.

A client can collide with itself — a retry, or a bug. The server therefore
refuses a `create` naming an existing row rather than overwriting it.
