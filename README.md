# todoer

Self-hosted personal task and information manager: offline-first, with web, CLI and Flutter clients.

## What is already here

This repository was created from `project-skeleton`, which supplies the process
layer and nothing else — no application code, no stack, no dependencies:

| Path | Holds |
| --- | --- |
| `.claude/CLAUDE.md` | the working agreement, and the headings project tooling reads |
| `specs/tasks/` | the task stack — one file per task, `active/` then `done/` |
| `scripts/check-pr-title.sh` | the Conventional Commits gate, runnable locally |
| `.github/workflows/` | that gate in CI, and its tests |
| `docs/adr/` | architecture decision records |

## First steps in a new project

1. Fill the placeholders: `grep -rn '<[A-Z_]\+>' . --exclude-dir=.git`.
2. Replace `LICENSE` with your own, and delete `scripts/smoke-test.sh` — it
   tests the template, not this project.
3. Set branch protection to require the checks named
   `PR title (conventional commit)` and `Shell tests`, and add any further
   required checks to `## Quality gates` in `.claude/CLAUDE.md` using the
   exact names branch protection uses.
4. Write ADR 0002 for the first decision this project makes that would
   otherwise be re-argued.

## What this skeleton deliberately omits

A package manager, a lockfile, a linter and a formatter. All four presume a
stack. They arrive when you choose one, which is when you will know which of
them apply.
