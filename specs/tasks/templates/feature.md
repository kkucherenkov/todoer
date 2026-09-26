# Feature task template

Copy this block into a new file at `specs/tasks/active/<id>.md` when starting a
task. Replace the placeholder values. The id is the creation date plus your
branch slug — `T-YYYY-MM-DD-<branch-slug>`, no counter to allocate; the format
and why it is not a number are in [`specs/tasks/README.md`](../README.md).

The sections follow GitHub Spec Kit's specification and task templates; what
was changed from them, and why, is under "Field rules" below.

```md
## T-YYYY-MM-DD-<branch-slug> — {short title, verb-led}

- Created: YYYY-MM-DD
- Owner: claude | @handle
- Status: draft | ready | in-progress | blocked | paused
- Blockers: —
- Spec: {design doc, ADR, issue, or "maintainer request, YYYY-MM-DD — {what}"}
- Plan: {docs/plans/… , or "none; the steps below are the whole change"}

### Goal

{Why this task exists, in one paragraph: the problem, not the steps.}

### Scenarios

1. **Given** {state}, **When** {action}, **Then** {observable outcome}
2. …

### Requirements

- **FR-001** {The server | The CLI | …} MUST {behaviour} (← {design doc
  question, ADR, or maintainer})
- **FR-002** …

### Edge cases

- {input or condition} → {expected behaviour} ({FR-NNN}, {TNNN})

### Definition of Done

- **SC-001** {measurable outcome a person can verify without reading code}
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001] {action} — `{path/to/file}`
- [ ] T002 [P] [FR-002] {action} — `{path/to/file}`
- **Checkpoint:** {what is demonstrably true at this point}

### Open questions

- [NEEDS CLARIFICATION: {question}]
```

Two kinds of placeholder appear above, and the difference is deliberate:
`<angle>` marks a part of a fixed format — the id is literally
`T-`, a date, and your branch slug — while `{brace}` marks a field you fill
with your own words, with the instruction for it inside the braces. Neither is
angle brackets around capitals, which is reserved for the values filled once
when the project is set up and is what `grep -rn '<[A-Z_]\+>' .` looks for —
spelling the form out here literally would make this sentence one of its hits.

## Field rules

- **Goal** is the _why_. The steps are the _how_. Keep them separate — the
  goal survives re-planning, the steps do not.
- **Scenarios** are what a human can verify without reading code. "Users can
  cancel a booking from the detail page" — not "CancelBookingCommand is
  dispatched".
- **Requirements** are numbered `FR-NNN`, say MUST, and name the decision they
  come from. A requirement nobody decided is a guess; mark it
  `[NEEDS CLARIFICATION: …]` instead.
- **Edge cases** are the inputs a reasonable person will send that the
  scenarios do not mention. Each names the FR that covers it and the step that
  tests it. An edge case with neither is an open question.
- **Definition of Done** holds measurable outcomes (`SC-NNN`) plus the fixed
  checklist. The checklist is the same in every entry on purpose: it is what
  "done" means in this repository, not per task.
- **Steps** are numbered `TNNN` (no hyphen, so a step never reads as a task id)
  and each references at least one FR. `[P]` marks a step that does not depend
  on the one before it. A **Checkpoint** line states what is true once the
  steps above it are done. When a plan in `docs/plans/` exists, a step names
  the plan task that details it and does not repeat its code.
- **Tests are not optional.** Spec Kit's template makes them opt-in; here
  every FR has a test that failed first, or the step says why it cannot have
  one (documentation-only work, for instance) and what checks it instead.
- **Status:** `draft` while any `[NEEDS CLARIFICATION]` remains or an FR has
  no step; `ready` when neither holds; `in-progress` once the first step
  starts. **Status: blocked** requires a filled `Blockers:` line naming what is
  needed and from whom. A blocked task with an empty blocker is an abandoned
  task.
