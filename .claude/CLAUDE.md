# <PROJECT> — quick reference

## Working agreement

Five rules that govern _how_ work happens here, independent of what is being
built. They apply to every task, including one-line fixes.

### 1. Answer in <LANG>

All prose addressed to the maintainer is in **<LANG>**. Code, identifiers, file
paths, commit messages, code comments, and everything committed to this
repository stay in **English** — the codebase has one language and it is not
the conversation's.

### 2. Plan before you touch anything

Every task starts with a plan, not an edit. Read the code the change touches,
trace the real flow end to end, then say what you intend to do before doing it.
For anything larger than a one-line fix, that plan becomes a file under
`specs/tasks/active/` **before** the first edit — not after.

If the task is ambiguous, if there is an architectural fork, or if a library
has to be chosen, ask **first**. A plan built on a guess costs more than the
question.

### 3. Update the documentation in the same pass

A change is not done when the code works. If the change alters behaviour,
structure, contracts, or setup, the docs that describe it change in the same
commit or PR.

**Never leave a document asserting something that is no longer true.** A stale
claim is worse than no claim.

### 4. Long-term memory lives outside the chat

Two tools, two roles, no overlap:

| Tool     | Holds                                            | Test                 |
| -------- | ------------------------------------------------ | -------------------- |
| `tuxedo` | **what still has to be done** — tasks, deadlines | a verb in the future |
| `dnote`  | **what was learned** — gotchas, rationale        | a fact in the past   |

Project key for both: `+<PROJECT>` / book `<PROJECT>`.

Write a note only when it will outlive the session **and** cannot be derived
from the repository. Never a retelling of the diff, the file layout, or git
history.

### 5. Record every change in the dnote changelog

One dedicated note holds the change history, newest first, one entry per landed
change:

```
YYYY-MM-DD · What changed — briefly, by substance.
```

What changed and why it matters, not which files were touched. Append before
reporting the work as finished.

## Task stack

One file per task: `specs/tasks/active/<id>.md` while it runs,
`specs/tasks/done/<id>.md` once it ships. Format and rationale in
[`specs/tasks/README.md`](../specs/tasks/README.md).

**Session start: read `specs/tasks/active/` first:**

```sh
find specs/tasks/active -name '*.md' -exec cat {} +
```

Not `cat specs/tasks/active/*.md` — with an empty stack that glob matches
nothing, which is an error in `sh` and refuses to run at all in `zsh`. The
first command of every session should not fail on the ordinary case of having
nothing in flight.

## Quality gates

The checks branch protection requires, spelled **exactly** as the branch
protection rule spells them. This list is read, not decorative: a required
check that has not started yet is absent from `gh pr checks` output, so a gate
that counts checks reads an unstarted one as passing. Compare against these
names.

- `PR title (conventional commit)`
- `Shell tests`

## Never do

- Commit to the default branch without a pull request.
- Skip updating `specs/tasks/active/` and `specs/tasks/done/`.
- Leave a document asserting something that is no longer true.

<!-- STACK:BEGIN -->
<!-- STACK:END -->
