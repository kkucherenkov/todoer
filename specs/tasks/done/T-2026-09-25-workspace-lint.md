## T-2026-09-25-workspace-lint — Add ESLint and Prettier to the workspace

- Created: 2026-09-25
- Owner: claude
- Spec: tuxedo 354; `chore: drop the lint task that checked nothing` (b0b9362)
- Goal: a `lint` gate that actually checks something — type-aware ESLint and
  Prettier across every hand-written file, enforced in CI.
- Acceptance:
  - `pnpm lint` fails on a floating promise, an unsafe `any`, or an
    unformatted file, and passes on the tree as committed.
  - A `Lint` check runs on every pull request, separate from the tests, and
    needs no database.
  - Spec files are typechecked: `pnpm typecheck` fails on a type error in a
    `*.spec.ts`, which it silently skipped until now.
  - Generated code (`packages/specs/src/generated`) is neither linted nor
    formatted by hand.
- Tests: mutation check — introduce each failure named above, watch the gate go
  red, revert.
- Sub-steps:
  - [x] Split `tsconfig.json` (everything, for typecheck and lint) from
        `tsconfig.build.json` (no specs) in `apps/backend` and `apps/cli`
  - [x] Fix the six type errors that surfaced in spec files
  - [x] Prettier: `singleQuote`, width 80; `.prettierignore` for generated code
        and the lockfile
  - [x] Reformat the tree in a commit of its own; record its SHA in
        `.git-blame-ignore-revs`
  - [x] ESLint flat config at the root, `typescript-eslint`
        `recommendedTypeChecked` with `projectService`; fix what it finds
  - [x] Per-package `lint` scripts and a `lint` turbo task (`dependsOn:
        ["^build"]` — type-aware rules need `@todoer/specs`'s `dist/` types)
  - [x] `Lint` job in CI; add it to Quality gates in `.claude/CLAUDE.md`
  - [x] README: how to run `pnpm lint` and `pnpm format`
- Status: done
- Blockers: —
- Completed: 2026-09-25
- Result: https://github.com/kkucherenkov/todoer/pull/4 — Markdown left out of
  Prettier (it rewrote ADRs); spec files now typechecked, six errors fixed.
