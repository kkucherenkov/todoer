## T-2026-10-03-fix-slow-exhaustive-tests — Keep the exhaustive specs inside their timeout on a loaded runner

- Created: 2026-10-03
- Owner: claude
- Status: done
- Blockers: —
- Spec: maintainer request, 2026-10-03 — CI run 37125454996 (PR #31) failed
  `gridSpan > holds for every month of 1990 to 2060` at 5755 ms against the
  default 5000 ms; `rankBetween > stays strictly between across random
  inserts…` timed out locally under turbo load (tuxedo 430)
- Plan: none; the steps below are the whole change

### Goal

Two CPU-bound specs run hundreds of milliseconds on an idle machine and about
ten times that when turbo builds the workspace beside them, which crosses
vitest's default 5000 ms per-test timeout. The checks are right; the cost and
the timeout are not sized for a shared runner. Both specs must keep covering
exactly what they cover today.

### Scenarios

1. **Given** a runner busy building the workspace, **When** the web and
   client-core suites run, **Then** both specs pass well inside their timeout.

### Requirements

- **FR-001** Each of the two specs MUST carry an explicit per-test timeout
  with a one-line reason; the global `testTimeout` stays at its default
  (← maintainer)
- **FR-002** A fixable cost inside the test itself MUST be fixed rather than
  hidden by the timeout, without reducing what the test asserts
  (← maintainer)

### Edge cases

- the rank loop hits a tie (`b >= a`, `b` dropped) → the new key may sort
  left of the gap index, so it is inserted at its binary-searched position,
  not at `k` (FR-002, T001); seed 7 produces no tie, the branch stays as a
  guard

### Definition of Done

- **SC-001** both specs pass under load with a margin of at least 10× to
  their timeout (measured below)
- [x] every FR has a test that failed before the code made it pass — n/a:
      the change is to the tests; the old and new rank loops were run side by
      side and produce the identical 2000-key sequence
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced — none
      describes these specs
- [x] dnote changelog line

### Steps

- [x] T001 [FR-002] keep the key list sorted by binary insertion instead of
      copying and sorting it on each of 2000 steps —
      `packages/client-core/src/rank.spec.ts`
- [x] T002 [FR-002] compare a month's days with one `toEqual` instead of one
      `expect` per day (about 36 000 calls) —
      `apps/web/app/utils/calendar.spec.ts`
- [x] T003 [FR-001] `30_000` per-test timeout on both, with the reason
- [x] T004 sweep the other `*.spec.ts` for exhaustive loops and slow tests
- **Checkpoint:** both specs pass under load; nothing else over 2 s lacks a
  timeout

### Results

Times of the single test, `vitest run -t`, 8-core machine.

| Spec     | Idle, before | Idle, after | Loaded, before | Loaded, after |
| -------- | ------------ | ----------- | -------------- | ------------- |
| rank     | 365 ms       | 20 ms       | 1325–4279 ms   | 17–27 ms      |
| calendar | 240 ms       | 140 ms      | 868–3735 ms    | 118–380 ms    |

"Loaded" is `turbo run build typecheck --force` for the before column and
either that or 16 busy-loop processes for the after column; the old specs
under the same 16 busy loops took 747–1090 ms (rank) and 598–813 ms
(calendar).

Sweep (T004): the only other test over 2 s in client-core, web and cli is
`apps/cli/src/store.spec.ts` › `never leaves SQLITE_BUSY unhandled…` (about
3.4 s), a multi-process race, not a range loop, which already sets
`120_000`. The other seeded loops (`rank.spec.ts` 300 rounds, twice) run under
100 ms. Backend specs were not run (shared `todoer_test` database);
`session.service.spec.ts`'s 15-step loop is not CPU-bound.
