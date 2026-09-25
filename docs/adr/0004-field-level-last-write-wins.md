# 4. Conflicts resolve per field

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Two devices edit the same task while apart. One of them has been offline for a
week. Something has to decide which edit survives.

## Decision

Last-write-wins **per field**, by a client timestamp the server clamps into
`[now − 24h, now + 5min]`. Timestamps live in a `field_ts` JSON column, one
entry per field. Destructive operations — deleting a row, changing a recurrence
rule — additionally carry `base_version` and are refused if the row has moved
on.

## Consequences

Because operations are field-scoped, two devices editing different fields of
one task do not conflict at all. The real collision is same-field, which is
rare for a single person.

A row-level timestamp would be simpler and would silently lose one of two edits
to different fields — which is the entire failure this decision exists to
prevent. That is why `field_ts` is a column rather than a `updated_at`.

The clamp is not defensive decoration. A device with a wrong system clock would
otherwise write a timestamp years in the future and pin that field permanently:
no later edit from any device could ever win, and nothing in the interface
would explain why.

Losing a title is annoying; losing the decision to delete something is not
recoverable, which is why only destructive operations pay for optimistic
concurrency.

A superseded edit is reported to the client as an outcome, not an error. The
server's value is already travelling in the same response.
