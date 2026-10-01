## T-2026-10-01-batch-outcomes — Report every operation of a command's batch

- Created: 2026-10-01
- Owner: claude
- Status: done
- Blockers: —
- Spec: tuxedo #408; found by the plan V1 review (views CLI, Task 3)
- Plan: none; the steps below are the whole change
- Completed: 2026-10-01

### Goal

`add` with labels and `done` with seeded statuses send several operations in
one batch. When the server refuses one of them, `submit` throws on the first
refused operation it reads: the command exits 1 with that operation's reason
and says nothing about the others. The server applies operations one by one,
so the others may well have landed — a `done` whose status write was refused
still marked the task done. A caller (often a script, ADR 0015) reads "refused"
as "nothing happened", repeats the command and queues duplicates.

### Scenarios

1. **Given** `done` on a task whose seeded status create is refused, **When**
   the server applies the occurrence and rejects the status write, **Then** the
   command exits 1 and stderr names the refused operations with their reasons
   and says how many others were applied.
2. **Given** a batch where one operation conflicts and the rest apply,
   **When** the command finishes, **Then** it exits 4 and says the rest were
   applied.
3. **Given** a single-operation command, **When** the server refuses it,
   **Then** the message is exactly what it is today.

### Requirements

- **FR-001** A command that sent several operations MUST, when any is
  rejected or conflicts, report each refused one (table, kind, reason) and the
  count of the others that were applied or are still queued.
- **FR-002** The exit code MUST be 1 when any operation was rejected, else 4
  when any conflicted; a fully settled batch exits as today.
- **FR-003** A single-operation command's message MUST stay unchanged.

### Edge cases

- every operation refused → no "applied" count, each reason listed (FR-001)
- a refused operation reported only through its outbox entry (sent by a
  parallel invocation) → counted like a reported one (FR-001)
- an operation unreported and still pending → counted as queued (FR-001)

### Definition of Done

- **SC-001** `done` with a refused status create prints both the refusal and
  that the mark was applied.
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002, FR-003] collect every own outcome in `submit`
      before throwing; one error naming each refused operation and the
      applied/queued count; HELP's exit-code text if it changes —
      `apps/cli/src/run.ts`, `apps/cli/src/protocol.ts`, `run.spec.ts`,
      `apps/cli/src/usage.ts`
- **Checkpoint:** scenarios 1–3 pass; the four gates green on the PR.

### Open questions

None.
