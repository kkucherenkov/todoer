## T-2026-09-25-walking-skeleton-sync-hardening — close the four sync defects the branch review found

- Created: 2026-09-25
- Owner: claude
- Spec: [sync design](../../../docs/specs/2026-09-25-domain-and-sync-design.md) §3,
  [ADR 0004](../../../docs/adr/0004-field-level-last-write-wins.md)
- Goal: `POST /sync` keeps both halves of a concurrent per-field edit, never lets one
  account's operation id or foreign key reach another's data, and answers a
  contract-legal `since` with a 4xx instead of a 500.
- Acceptance:
  - Two concurrent `set` operations on different fields of one row both survive,
    each with its own `fieldTs`, and `version` counts both.
  - An operation id already used by one account applies normally for another.
  - `since: 1e300` and `since: 2^53 + 1` are rejected as client errors, in
    problem+json, and the OpenAPI document bounds the field.
  - An operation whose `projectId`/`parentId`/`taskId`/`tagId` points at a row
    owned by someone else is rejected.
  - A task cannot become its own parent, cannot be parented under a task that
    already has a parent, and cannot close a cycle — each refused as that
    operation's own `rejected`, with a reason, never as a 5xx.
- Tests: integration (`apps/backend/src/sync/sync.service.spec.ts`) — the
  concurrency case stages two genuinely overlapping transactions through
  `prisma.$extends`, not two sequential calls.
- Sub-steps:
  - [x] C1 — serialise the read-modify-write cycle with a row lock
  - [x] C2 — scope operation dedup by `(userId, opId)`, in the schema and the lookup
  - [x] I3 — bound `since` in the contract and in the service guard
  - [x] I9 — reject a foreign key that points outside the account
  - [x] M17 — refuse a self-parent by the rules, not by the constraint
  - [x] M17 — refuse a third level and every cycle, on the lookup I9 already does
  - [x] M17 — classify SQLSTATE 23514 as not retryable, so it is not a 5xx
- Status: in-progress
- Blockers: —
