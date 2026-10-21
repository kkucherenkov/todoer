## T-2026-10-21-web-redesign-nav — Add core-backed navigation presets and quick add

- Created: 2026-10-21
- Owner: Codex (Web)
- Status: in-progress
- Blockers: Navigation only: core task C2 must publish watchable Today,
  Upcoming and project projections plus their unique open-task counts. The
  coordinator approved progressive quick add as independent W2 Part 1 on
  2026-10-21.
- Spec: [web redesign context](T-2026-10-03-web-redesign-context.md), FR-007;
  maintainer-approved rules in the
  [web UX redesign plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md),
  stage 2
- Plan: [web UX redesign](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md),
  stage 2

### Goal

The sidebar must expose the standard open-task perspectives and projects with
counts derived by the shared engine, while quick add remains a small,
progressively disclosed entry point that preserves the user's intent through
offline acceptance or refusal. Web must not duplicate the replica's filtering
or silently add dates to make a new task fit the current preset.

### Scenarios

1. **Given** open tasks, including collapsed children, **When** the sidebar is
   shown, **Then** All open, Today, Upcoming and every project link display
   unique counts computed by core and open the matching core projection.
2. **Given** a task scheduled or due on the local current date, **When** the
   date rolls over or a hidden tab returns, **Then** Today and Upcoming are
   recomputed without a reload.
3. **Given** a title containing `#project`, `@tag` and `pN`, **When** quick add
   is submitted, **Then** the existing core grammar creates the task with P4
   as the default and optional fields remain available through progressive
   disclosure.
4. **Given** an offline write accepted into the replica, **When** quick add
   completes, **Then** the draft clears, the task appears where its real
   fields place it and the queued state is visible.
5. **Given** a refused quick-add write, **When** the result is shown and the
   user retries, **Then** the draft remains and the same minted operation is
   retried.
6. **Given** a task created from a preset that its fields do not match,
   **When** the write is accepted, **Then** no date is added silently and a
   localized link keeps the task reachable in All open.

### Requirements

- **FR-001** Web MUST render All open, Today, Upcoming and live projects as
  navigation destinations backed by core projections, never by a second
  client-side reading or filtering of the replica (← redesign plan stage 2).
- **FR-002** Core-backed navigation counts MUST count each matching open task
  once, including children hidden by a collapsed parent; Today and Upcoming
  MUST match scheduled OR due against the engine's local date (← redesign
  plan approved rules and stage 2).
- **FR-003** Date-dependent projections and counts MUST recompute at local-day
  rollover and when the tab becomes visible or focused again (← redesign plan
  stage 2).
- **FR-004** Quick add MUST begin with the title, progressively reveal
  optional project, tags, priority, scheduled and due fields, and preserve the
  existing `parseQuickAdd` grammar `#project @tag pN`, where P0 is highest and
  P4 is the default (← redesign plan approved rules; C0).
- **FR-005** A refused quick add MUST retain the draft and reuse its minted
  operation on retry; an accepted offline write MUST clear the draft and show
  the shared queued state (← context FR-007; redesign plan stage 2).
- **FR-006** Quick add MUST NOT infer dates from the active preset. When the
  created task is outside that projection, Web MUST expose a localized route
  to it through All open (← redesign plan approved rules and stage 2).

### Edge cases

- One task matching both scheduled and due → one count and one projected item
  (FR-002, T002).
- A matching child whose parent is collapsed or outside the filter → counted
  once (FR-002, T002).
- Local midnight while the tab stays visible, and midnight while hidden → the
  first cadence tick or return recomputes navigation and the active projection
  from one engine-local date (FR-003, T002).
- Marker-only input or an unknown/refused label → core refusal remains visible
  and the complete draft survives (FR-004–005, T003).
- Optional project and priority controls override the parsed markers; field
  tags are added to the title's `@tags`; no scheduled or due date is injected
  (FR-004, FR-006, T003).
- A field tag core's grammar would not read as a tag → refused before any
  write, the draft stays (FR-004–005, T003).
- The add is accepted but the structured edit is refused → the error says the
  task was created and its details were not saved; a retry, even with changed
  fields, edits that same task and never adds a second one (FR-005, T003).

### Known limits

- The pending add/edit attempt lives in the tab's memory: closing the tab
  between an accepted add and a refused edit loses the structured fields; the
  task itself exists.
- After an accepted add, a changed title reaches the task as an edit of its
  title; `#project`, `@tag` and `pN` typed into it then are not re-read — use
  the fields.
- A `#name` in the title creates that project even when the Project field
  overrides it. Fixing it needs core `add` to accept the changes in one write —
  a core follow-up, not this stage.

### Definition of Done

- **SC-001** EN/RU users can navigate the four core-backed destination kinds,
  see unique counts and add a task through the title-first form while online
  or offline.
- **SC-002** A pinned clock proves Today/Upcoming rollover and a refused-write
  fixture proves draft/opId retention.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001–003] Trace the current catalog/watch/date contracts and
  record the missing core-owned projection and count contract before editing
  Web — `packages/client-core/src/engine-protocol.ts`,
  `packages/client-core/src/engine.ts`, `packages/client-core/src/operations.ts`
- [ ] T002 [FR-001–003] Add failing-first unit and Playwright contracts for
  destinations, unique counts and pinned rollover, then consume the core
  contract — `apps/web/app/components/ViewNav.vue`, `apps/web/app/pages/`,
  `apps/web/e2e/`
- [x] T003 [FR-004–006] Add failing-first grammar, refusal, offline and
  out-of-filter checks, then implement progressive quick add —
  `apps/web/app/components/QuickAdd.vue`, `apps/web/e2e/`
- [ ] T004 [FR-001–006] Update affected docs, run Web unit/typecheck/lint/build
  and the touched e2e specs, then record the dnote changelog line — `docs/`,
  `specs/tasks/`
- **Checkpoint:** Part 1 may land progressive quick add independently;
  navigation remains BLOCKED-ON-CORE C2 until the projections and counts below
  are published.

### Open questions

- Core contract required by FR-001–003: extend the public watch key from only
  `all | saved-view-id` to opaque built-in/project keys for `today`,
  `upcoming` and `project:<id>` (or an equivalently typed selector), and
  publish navigation entries with `{ key, kind, id?, count }`. `count` is the
  number of unique open task ids in that projection, including subtasks; a
  task matching both scheduled and due is counted once. Today matches a
  scheduled or due date on or before the engine's `localDate(now())`;
  Upcoming matches either date after it. Project matches the core-resolved
  project id. The active projection and all counts are republished from the
  same local date on normal engine ticks/focus publishes. The existing `all`
  projection stays all open tasks and is not renamed or narrowed to Inbox.
