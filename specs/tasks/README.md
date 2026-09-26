# Task stack

The only durable record of what Claude (or a human) is working on, what is
blocked, and what has already shipped. Two directories, **one file per entry**:

- **`active/`** — work in flight. One file per task, named after its id.
- **`done/`** — the archive. Shipped and cancelled tasks, same file, moved here
  with `git mv`.

There is no index file and nothing to regenerate: `ls specs/tasks/active/` is
the stack, and `cat specs/tasks/active/*.md` reads it.

## An entry is a task spec

Each entry is the specification of one task: scenarios, numbered requirements
(`FR-NNN`), edge cases, a Definition of Done and steps (`TNNN`) that reference
the requirements they satisfy. The sections and their rules are in
[`templates/feature.md`](templates/feature.md); they follow GitHub Spec Kit's
specification and task templates, used as a format only — the `specify` CLI is
not part of this repository.

Three documents, three questions, no overlap:

| Document                     | Answers                                        | Written                   |
| ---------------------------- | ---------------------------------------------- | ------------------------- |
| `docs/specs/*-design.md`     | **why this way** — decisions, rejected options | by the design interview   |
| `specs/tasks/active/<id>.md` | **what must be true** — FRs, DoD, steps        | before the first edit     |
| `docs/plans/*.md`            | **exactly how** — code, commands, output       | for multi-step work only  |

A requirement cites the design decision it comes from; a step cites the plan
task that details it. Neither repeats the other document's content, so each
fact has one place to go stale.

Entries in `done/` written before this format keep their old shape. They are
the record of what happened and are not rewritten.

## Why one file per entry

The obvious layout is two files, `active.md` and `done.md`, each an
append-at-the-top list. Every lane then writes at the top of the same file, so
every lane after the first hits a conflict there — in a file whose entries
never actually overlap.

A custom merge driver (`merge=taskstack`) resolves that locally and works. It
cannot help where the cost actually lands: **GitHub does not run custom merge
drivers.** It computes mergeability with a plain three-way merge, so the PR
page says CONFLICTING regardless, the lane has to rebase, the force-push
restarts the whole CI run, and a green PR goes back through the full check
suite to absorb a bookkeeping line.

Separate files cannot conflict — locally or on GitHub. Finishing a task is a
rename, which git tracks by itself, so the "the other lane already moved this
entry to done" case that the driver needed special code for cannot arise.

## Rules

1. **Before touching code**, create `active/<id>.md` from
   [`templates/feature.md`](templates/feature.md).

2. **While working**, tick steps in place. If the task is blocked, set
   `Status: blocked` and fill `Blockers:`. A requirement that changes during
   the work changes in the entry first, then in the code.

3. **When shipped**, every Definition of Done item is ticked;
   `git mv specs/tasks/active/<id>.md specs/tasks/done/`, set `Status: done`,
   and add `- Completed: YYYY-MM-DD` and `- Result: <PR link>`. Edit the file
   and `git add` it before the `git mv`, or the move commits the old content.
   The entry must reference the spec it implemented so the audit trail
   survives.

4. **Never delete** a file from `done/`. A cancelled task moves there with
   `- Result: cancelled — <reason>`.

5. **Stack depth** — `active/` should rarely hold more than three files. If it
   does, something is being left half-done. Close or cancel before opening the
   next.

## Task ID format

`T-YYYY-MM-DD-<branch-slug>` — the date the entry was created, then the task's
own branch with its Conventional-Commits type prefix dropped and `/` replaced
by `-`:

| Branch                    | Id                                 |
| ------------------------- | ---------------------------------- |
| `fix/dark-theme-contrast` | `T-2026-01-15-dark-theme-contrast` |
| `feat/export-to-markdown` | `T-2026-01-15-export-to-markdown`  |
| `chore/bump-node-22`      | `T-2026-01-15-bump-node-22`        |

**Do not allocate a number.** A counter of the form `T-YYYY-MM-DD-NNN` has no
allocator: a lane picks the next free number by reading what exists, so two
lanes working at the same time read the same state and pick the same number.
A branch slug needs no allocator because the uniqueness already exists further
up — two lanes cannot share a branch.

The filename is the id, so a collision is not a merge conflict; it is two lanes
trying to create the same path, which git refuses outright.
