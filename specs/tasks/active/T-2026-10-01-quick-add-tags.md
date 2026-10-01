## T-2026-10-01-quick-add-tags — Store quick-add projects and tags, and merge duplicate names

- Created: 2026-10-01
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-09-28-quick-add-tags-projects-design.md](../../../docs/specs/2026-09-28-quick-add-tags-projects-design.md)
  (Q1–Q10); ADR 0005, 0007; tuxedo #362
- Plan: [docs/plans/2026-10-01-plan-quick-add-tags.md](../../../docs/plans/2026-10-01-plan-quick-add-tags.md)

### Goal

`todoer add "call the bank @phone #finance p2"` keeps the title and the
priority and drops the rest with a note. A task cannot carry a project or a
context, and `list` cannot narrow by either. Storing them means resolving
names to rows, and two offline clients can create the same name before either
hears of the other's. The design tolerates such duplicates, treats same-named
rows as one, and merges them automatically after each pull.

### Scenarios

1. **Given** no tags, **When** a caller adds `"call the bank @phone #finance"`,
   **Then** a tag `@phone`, a project `finance`, the task and its TaskTag are
   queued in that order, and stderr says what was created.
2. **Given** a tag `@phone`, **When** a caller adds `"… @Phone"`, **Then** the
   existing tag is reused.
3. **Given** tasks tagged `@phone` and `@home`, **When** a caller runs
   `list @phone @home`, **Then** only tasks carrying both are listed, each
   line ending with its `#project @tags`.
4. **Given** two live tags named `@phone` from two devices, **When** a client
   pulls them, **Then** it queues the merge: every TaskTag moves to the
   lower id, the other tag is deleted, and the next command sends it.
5. **Given** an archived project `finance`, **When** a caller adds
   `"… #finance"`, **Then** a new project `finance` is created and the
   archived one is untouched.

### Requirements

- **FR-001** `@todoer/specs` MUST export `nameKey(name)` = NFC then lower case,
  pinned by `vectors/names.json` (← design Q4).
- **FR-002** `add` MUST resolve `#project` against live, non-archived projects
  and each `@tag` against live tags by name key, picking the lowest id among
  matches; an unknown name is created (← design Q1, Q3, Q5, Q8).
- **FR-003** `add` MUST queue tag and project creates, then the task (with
  `projectId`), then one derived-id TaskTag per distinct tag, atomically, and
  report each created name on stderr (← design Q3).
- **FR-004** `@phone` MUST be stored as the name `@phone`; `#finance` as
  `finance` (← design Q2).
- **FR-005** The exit code of `add` MUST reflect every operation it queued:
  any refused one is exit 1 (← ADR 0015).
- **FR-006** `list` MUST show `#project @tag…` after the title and put
  `project` and `tags` in `--json` rows (← design Q6).
- **FR-007** `list @tag #project …` MUST keep only tasks carrying every named
  label, matched by name key; any other argument is exit 2 (← design Q6).
- **FR-008** After every pull a client MUST queue the merge of every group of
  live, server-confirmed tags (or live, non-archived projects) with the same
  name key: references moved to the lowest id, the rest deleted with their
  `baseVersion` (← design Q7, Q8, Q9, Q10; plan departure 1).
- **FR-009** Merge operations MUST NOT be sent by the command that queued
  them, and MUST be reported on stderr (← design Q9).
- **FR-010** HELP, README, ADR 0007 and the walking skeleton MUST describe and
  prove the stored markers (← project rule 3).

### Edge cases

- `@a @A` in one add → one tag, one TaskTag (FR-002, T002)
- a tag pending in the outbox (created offline, not yet on the server) → reused
  by a later add, never merged until the server has it (FR-002, FR-008, T002,
  T005)
- a task already carrying both duplicate tags → its loser link is detached and
  the winner link stays attached (FR-008, T005)
- an archived project with the same name as a live one → never merged
  (FR-008, T005)
- `list foo` → exit 2 (FR-007, T004)
- a TaskTag that is detached (`attached: false`) → not shown, not moved
  (FR-006, FR-008, T004, T005)

### Definition of Done

- **SC-001** `sh scripts/walking-skeleton.sh` adds a tagged task in one
  replica and `list @<tag>` in the second finds it.
- **SC-002** Scenario 4 passes as a `run` test against the fake server: after
  two commands only one `@phone` tag is live.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] name key and its vectors — plan Task 1
- [x] T002 [FR-002, FR-004] resolve and label tasks, pure — plan Task 2
- [x] T003 [FR-003, FR-005] `add` stores the markers; multi-op submit —
      plan Task 3
- [x] T004 [FR-006, FR-007] `list` shows and filters by labels — plan Task 4
- [ ] T005 [FR-008] plan the merge, pure — plan Task 5
- [ ] T006 [FR-008, FR-009] queue the merge after every pull — plan Task 6
- [ ] T007 [FR-010] HELP, README, ADR 0007, walking skeleton — plan Task 7
- **Checkpoint:** scenarios 1–5 pass; the four gates green on the PR.

### Open questions

None.
