> [!NOTE]
> **This is `project-skeleton`'s own README.** If you created this repository
> from the template, delete everything above the horizontal rule below, then:
>
> 1. `grep -rn '<[A-Z_]\+>' . --exclude-dir=.git` — every placeholder to fill.
> 2. Replace `LICENSE` with your own. The one here covers the template.

# project-skeleton

A GitHub template that gives a new project its **process** on the first commit,
and deliberately nothing else: no framework, no package manager, no lockfile,
no linter. Those arrive when you pick a stack. This arrives before you do.

It was extracted from a real repository after that repository had spent a year
paying for the alternatives, so most of what is here is a rule with a reason
attached rather than a preference.

## What you get

| Path | Holds |
| --- | --- |
| `specs/tasks/` | a task stack — one file per task, `active/` then `done/`, no index to regenerate and nothing two branches can collide on |
| `.claude/CLAUDE.md` | a five-rule working agreement, plus named headings that tooling reads for project facts |
| `scripts/check-pr-title.sh` | a Conventional Commits gate in POSIX shell — no Node, runs anywhere, with its own table test |
| `scripts/check-pr-title.test.sh` | that gate's tests, run in CI |
| `.github/workflows/` | the gate on the `edited` trigger most setups forget, and the gate's own tests |
| `docs/adr/` | architecture decision records, starting with the ADR that says to write them |
| `scripts/smoke-test.sh` | maintainer-only: verifies the published template. It refuses to run outside this repository |

Each carries the reasoning for its shape. `specs/tasks/README.md` explains why
the task id is a branch slug and not a counter, and why two files would have
been the wrong layout — both answers cost real time to learn.

## Using it

```sh
gh repo create my-thing --template kkucherenkov/project-skeleton --private --clone
cd my-thing
grep -rn '<[A-Z_]\+>' . --exclude-dir=.git
```

Then set branch protection to require `PR title (conventional commit)` and
`Shell tests`.

## Why there is no tooling in it

A skeleton that ships `package.json` has chosen Node for you. This one is
installed into projects whose stack is not decided yet — sometimes into
projects that will never have a package manager at all — so the one piece of
logic it contains is written in the language every machine already has.

MIT licensed. Issues and pull requests welcome.

---

# <PROJECT>

<SUMMARY>

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
