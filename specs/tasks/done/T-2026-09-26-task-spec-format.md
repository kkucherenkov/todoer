## T-2026-09-26-task-spec-format — Turn the task entry into a task spec

- Created: 2026-09-26
- Owner: claude
- Status: done
- Blockers: —
- Spec: maintainer request, 2026-09-26 — adopt the task format of GitHub Spec
  Kit (`templates/spec-template.md`, `templates/tasks-template.md`, v1.0.12)
  without its CLI
- Plan: none; the steps below are the whole change
- Completed: 2026-09-26
- Result: https://github.com/kkucherenkov/todoer/pull/6

### Goal

A task entry states what must be true when the task is done, in a form that can
be checked, and ties every step and test to a requirement. Today's entry has a
goal, a loose acceptance list and unlinked sub-steps: nothing says which step
satisfies which requirement, or when the task counts as done.

### Scenarios

1. **Given** a new task, **When** its entry is written from the template,
   **Then** it has scenarios, numbered requirements, edge cases, a Definition
   of Done and steps that reference requirements.
2. **Given** an entry with an unresolved `[NEEDS CLARIFICATION: …]`, **When**
   someone reads its status, **Then** the status is `draft`, not `ready`.
3. **Given** a finished task, **When** its entry moves to `done/`, **Then**
   every Definition of Done item is ticked and the entry links the PR.

### Requirements

- **FR-001** The template MUST carry the sections Goal, Scenarios,
  Requirements, Edge cases, Definition of Done, Steps and Open questions.
- **FR-002** Requirements MUST be numbered `FR-NNN` and phrased with MUST, and
  each MUST name the decision it comes from (design doc question, ADR, or the
  maintainer).
- **FR-003** Steps MUST be numbered `TNNN`, reference at least one `FR-NNN`,
  and name the file they touch; `[P]` marks a step with no dependency on the
  previous one.
- **FR-004** The Definition of Done MUST contain measurable outcomes
  (`SC-NNN`) and the fixed repository checklist: tests that failed first, the
  four gates, documents, changelog.
- **FR-005** The status set MUST distinguish `draft` (open questions remain)
  from `ready` (none remain, every FR has a step).
- **FR-006** Tests MUST NOT be optional, unlike the Spec Kit template: every FR
  has a test or an explicit reason it cannot have one.
- **FR-007** The README MUST describe how the task spec relates to the design
  doc and the implementation plan, and `CLAUDE.md` MUST point at it.
- **FR-008** Entries already in `done/` MUST NOT be rewritten.

### Edge cases

- A task with no code (documentation only): FRs still apply; the test for each
  is the check named in its step (FR-006).
- A task too small for a plan: the entry's steps are the plan; `Plan:` says so.
- A step number (`T001`) next to the task id (`T-2026-09-26-…`): the step has
  no hyphen and no date, so neither reads as the other.

### Definition of Done

- **SC-001** A new entry written from the template needs no section the
  template lacks, and B2 (`T-2026-09-26-prune-and-snapshot`) is the first
  entry written that way.
- **SC-002** `find specs/tasks/active -name '*.md' -exec cat {} +` still
  prints the whole stack.
- [x] every FR checked against the finished template (documentation only, no
      code tests)
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still describes the old entry format
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001] [FR-002] [FR-003] [FR-004] [FR-005] [FR-006] Rewrite the
      template — `specs/tasks/templates/feature.md`
- [x] T002 [FR-007] [FR-008] Document the three documents' roles, the
      statuses and the numbering — `specs/tasks/README.md`
- [x] T003 [P] [FR-007] Point the task-stack section at the new format —
      `.claude/CLAUDE.md`
- [x] T004 [FR-001] Review the Markdown by hand: `.prettierignore` excludes
      `*.md` and there is no markdownlint config
- **Checkpoint:** the template, the README and `CLAUDE.md` agree on sections,
  statuses and numbering.

### Open questions

None.
