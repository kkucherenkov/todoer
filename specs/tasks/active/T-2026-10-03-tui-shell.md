## T-2026-10-03-tui-shell — Start the terminal client

- Created: 2026-10-03
- Owner: claude
- Status: done
- Completed: 2026-10-03
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q1, Q3, Q5)
- Plan: docs/plans/2026-10-03-plan-t2-tui-shell.md

### Goal

A person who uses the CLI opens `todoer-tui` and sees their views and tasks,
works offline, and stays in sync, on the replica and session the CLI already
has. The outline, board, details and statuses plans build on this shell.

### Scenarios

1. **Given** `todoer login` was run, **When** `todoer-tui` starts, **Then**
   the sidebar lists "All open" and the saved views and the pane lists the
   open tasks.
2. **Given** no session, **When** it starts, **Then** it says to run
   `todoer login` and `q` quits with 0.
3. **Given** the server is down, **When** a task is added, **Then** it shows
   at once and the status bar reads `offline · 1 pending`.
4. **Given** `todoer add x` ran in another shell, **When** the next tick
   passes, **Then** `x` is listed.

### Requirements

- **FR-001** The TUI MUST open the CLI's replica and session (← design Q3)
- **FR-002** The TUI MUST run the core engine and render its topics (← Q5)
- **FR-003** The TUI MUST sync at start, after every write and every 30 s,
  and on `r` (← Routine choices, sync cadence)
- **FR-004** A failure MUST show as one status-bar line; offline is not an
  error (← Routine choices, failures)
- **FR-005** Without a session the TUI MUST say to run `todoer login`
  (← Routine choices, failures)
- **FR-006** The CLI and the TUI MUST share one implementation of opening the
  replica and reading the environment (← maintainer: no duplication)

### Edge cases

- `TODOER_TOKEN` set and no stored session → signed in (FR-001, T002)
- A refresh refused → signed-out screen (FR-005, T002)
- Terminal narrower than 80 columns → sidebar hidden (FR-002, T004)

### Definition of Done

- **SC-001** `todoer-tui` against a live backend lists, adds, completes and
  deletes a task, and the CLI sees each change
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-006] move openStore/readConfig into the core — plan Task 1
- [x] T002 [FR-001] [FR-005] package, session adapter, topics — plan Task 2
- [x] T003 [FR-002] [FR-004] widgets, write hook, status bar — plan Task 3
- [x] T004 [FR-002] [FR-003] app, sidebar, flat list, cadence, main — plan Task 4
- [x] T005 documents and PR — plan Task 5
- **Checkpoint:** feature plans can start on this branch's merge

### Departures from the plan

1. `apps/cli/src/run.spec.ts` imported the deleted `./store.js` too; the plan
   listed only `store.spec.ts` and `config.spec.ts`. It now imports
   `openReplica` from the core. The comment over the parallel-opens test
   described the `tsc` build the plan removed and was rewritten.
2. `LineFields.title` and `priority` are optional: `Item` is a `Row` that
   does not promise them, so `lineOf(current)` did not typecheck.
3. `Topics$.subscribe`, `StatusLine.subscribe` and the kit's `cleanup` are
   arrow properties, not methods: type-aware ESLint's `unbound-method`
   rejects handing a method to `useSyncExternalStore` or `afterEach`.
4. The sidebar spreads `color` in only for the current view:
   `exactOptionalPropertyTypes` refuses `color={undefined}`.
5. `renderTui` returns `lastFrame`, `frames` and `stdin`, not the whole
   `ink-testing-library` instance, whose `Stdout` has a private field an
   exported inferred type cannot name (TS4094).
6. `settle` waits until no engine command is in flight and no frame was
   drawn for 50 ms, instead of a fixed 20 ms. Ink 8 holds a lone Esc for
   20 ms before it reports Escape, and on a loaded machine React commits a
   write's `.then` late, so the `useInput` hooks it re-enables missed the
   next key (1 run in 10 failed before; 16 of 16 under parallel load after).
7. A write's own send does not update the `sync` topic's `reached`; only a
   sync does (`engine.ts`, outside this task). So "offline · 1 pending"
   shows after the next sync (`r` or the tick), not right after the write.
   The status-bar spec and the app spec press `r` / sync first.
8. The StatusPicker spec has no "no statuses" case: the engine seeds three
   default statuses on a first sync against an empty server, so the kit
   cannot reach it.
9. Not in the plan: `key-hold.ts`. Ink hands every key to every active
   `useInput`, so `q` typed into a new task quit the TUI and `r` started a
   sync (found in the by-hand run). `LineInput` and `Picker` hold the
   keyboard while mounted (a no-op outside `TuiContext`), and `App`'s
   global keys yield. `Tui` gains `keys`; the feature plans' widgets get
   this for free.
10. Stronger tests than the plan's: the in-place edit asserts the tag
    landed; offline `useWrite` is offline from the start (the plan's went
    offline after the write); `r` and the signed-out screen have tests
    (FR-003, FR-005).

### By-hand run (plan Task 4 Step 6)

Backend built from this branch on port 3077 against a fresh `todoer_tui`
database, a scratch `HOME`, a user registered over HTTP and `todoer login`
done. `todoer-tui` in a 110×30 PTY: the sidebar listed All open, the pane
listed the CLI's `milk`, the bar read `synced`. `o` added a task, `x`
completed one, `dd y` deleted one, and `todoer list` in another shell showed
each change. A task the CLI added appeared after `r`. `q` exited with 0.

A driver that does not read the PTY between keys makes Node block on its
writes, and the typed keys then arrive as one chunk, which Ink treats as a
paste (Enter inside it is text). A person typing does not hit this.

### Open questions

None.
