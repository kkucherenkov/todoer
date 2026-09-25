## T-2026-09-25-parent-depth-and-locking — Hold the two-level rule under concurrency and re-parenting

- Created: 2026-09-25
- Owner: claude
- Spec: tuxedo 355 and 356; `docs/specs/2026-09-25-domain-and-sync-design.md`
  §3 "Permitted?"; ADR 0009
- Goal: no sequence of `POST /sync` requests, concurrent or not, can store a
  task hierarchy deeper than two levels or with a cycle in it.
- Decision (maintainer, 2026-09-25): a task that has live subtasks may **not**
  be given a parent. The client splits the subtree first. Tombstoned subtasks
  do not count: a deleted row cannot be resurrected, so it never becomes a
  live third level.
- Acceptance:
  - `set parentId` on a task with a live subtask is `rejected` with a reason;
    with only deleted subtasks it is `applied`.
  - Two concurrent `set parentId` operations pointing at each other: exactly
    one is `applied`, the other `rejected`, no 500, no cycle stored.
  - `set parentId` on T racing a `create` of a subtask under T: exactly one of
    them lands.
- Tests: DB-backed specs in `sync.service.spec.ts`; each concurrency test
  checked by removing the locking and watching it go red.
- Sub-steps:
  - [x] Lock the written row and the `parentId` target, in id order, before
        the reference checks read either
  - [x] Reject `set parentId` on a task with live children
  - [x] Specs: the rule, the mutual-parent race, the parent-vs-new-child race
  - [x] Design doc §3: replace the two "known gap" paragraphs with the rule
        and the lock order
- Status: done
- Blockers: —
- Completed: 2026-09-25
- Result: https://github.com/kkucherenkov/todoer/pull/5 — locks the written row and parentId target in id order
  before the checks; a task with live subtasks cannot be given a parent.
