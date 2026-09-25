## T-2026-09-25-walking-skeleton-review-remainder — close the review findings the sync pass did not own

- Created: 2026-09-25
- Owner: claude
- Spec: [walking skeleton plan](../../../docs/plans/2026-09-25-walking-skeleton.md),
  [ADR 0015](../../../docs/adr/0015-the-cli-is-a-client-for-automation.md),
  [ADR 0016](../../../docs/adr/0016-the-sync-cursor-is-not-linearizable.md)
- Goal: every remaining finding of the whole-branch review is either fixed or
  written down where the person it would bite will read it — the CLI's exit
  codes tell a caller what to do, the test suite cannot destroy a developer's
  database, and CI proves the loop it claims to prove.
- Acceptance:
  - An expired token exits with the refusal code, not the network one, and a
    server-side conflict has a code of its own (ADR 0015 §2's four).
  - `todoer add "#groceries"` refuses instead of creating an untitled task, and
    an `add` carrying `#`/`@` says they are not stored yet.
  - `PORT=abc` fails to start instead of binding a random port.
  - A task cannot become its own parent.
  - `pnpm test` against a non-test `DATABASE_URL` refuses to run at all.
  - CI runs `scripts/walking-skeleton.sh` against a real server and fails the
    job if it does not print `walking skeleton passed`.
  - `turbo run lint` no longer reports success for a gate that checks nothing.
  - README describes the stack that exists and how to run it, including the
    15-minute token and that `add` is not safe to retry.
- Tests: unit (`apps/cli/src/protocol.spec.ts`, `parse-quick-add.spec.ts`,
  `apps/backend/vitest.setup.spec.ts`, `app-config.spec.ts`), integration
  (`apps/backend/src/sync/sync.service.spec.ts` for the self-parent refusal),
  and CI itself for the end-to-end proof.
- Sub-steps:
  - [x] I6 — a test run refuses a database not marked as a test database
  - [x] I4/M12 — 4xx is a refusal, `OpResult.status === 'conflict'` is exit 4
  - [x] I5/I8 — refuse an empty title, name what `#`/`@` do not yet do, `--help`
  - [x] M16 — a non-numeric `PORT` fails at startup
  - [x] M17 — a self-parent is refused by the database (partial, see Blockers)
  - [x] I7 — CI runs the proof script against a running server
  - [x] M15 — drop the vacuous `lint` task
  - [x] I10 — README describes this repository
  - [x] M11 — ADR 0016 says there is currently no recovery
- Status: in-progress
- Blockers: M17 lands the invariant (a CHECK constraint) but the refusal
  surfaces as a 5xx rather than as `{ status: 'rejected' }` for the one
  operation — Postgres raises SQLSTATE 23514, Prisma wraps it as
  `PrismaClientUnknownRequestError`, and `isRetryable` in
  `apps/backend/src/sync/sync.service.ts` defaults an unrecognised class to
  retryable. Closing it is one line in that file or three in `apply-op.ts`,
  both owned by the sync pass. Cycles longer than one node (A→B→A) and depths
  past two levels need the same owner.
