# Contributing

## Before you write code

Read `specs/tasks/active/`. That is the current stack of work:

```sh
find specs/tasks/active -name '*.md' -exec cat {} +
```

Then create your own entry from `specs/tasks/templates/feature.md`, named
`T-YYYY-MM-DD-<your-branch-slug>.md`. Before the first edit, not after.

## Branches and commits

- Work on a branch; the default branch takes changes only through a pull
  request.
- Commit subjects and PR titles follow Conventional Commits. The PR title is
  what a squash merge puts on the default branch, so it is gated in CI —
  `scripts/check-pr-title.sh` is the same check, runnable locally:

```sh
sh scripts/check-pr-title.sh "feat(web): add the calendar view"
```

  The rules it enforces: one of `feat`, `fix`, `chore`, `docs`, `refactor`,
  `test`, `perf`, `ci`, `build`, `style`, `revert`; an optional scope in
  parentheses with no restriction on its characters; an optional `!` for a
  breaking change; then `: ` and a description that does not start with a
  space. **The whole subject is at most 72 characters** — characters, not
  bytes, so an em dash costs one. Commitlint's own default is 100; this is
  shorter because the subject becomes a commit message on the default branch,
  where `git log --oneline` truncates.

- The commit body says **why**. What changed is what `git diff` is for.

## Finishing

```sh
git mv specs/tasks/active/<id>.md specs/tasks/done/
```

Set `Status: done`, add `- Completed:` and `- Result: <PR link>`. Never delete
a file from `done/` — a cancelled task moves there with its reason.
