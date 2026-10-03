## T-2026-10-03-engine-spec-lint — Type-check the engine spec like the rest of the core

- Created: 2026-10-03
- Owner: claude
- Status: done
- Completed: 2026-10-03
- Blockers: —
- Spec: maintainer request, 2026-10-03 — strict typing everywhere; tuxedo 429
- Plan: none; the steps below are the whole change

### Goal

`packages/client-core/src/engine.spec.ts` moved from the web in PR #27 and
kept the web's `disableTypeChecked` rules through an override in
`eslint.config.mjs`, because it had 42 errors under the core's
`recommendedTypeChecked`. It was the only file in the core that the
type-aware rules did not see, so a mock typed `any` could hide a test that no
longer matches the engine's contract.

### Scenarios

1. **Given** the override is gone, **When** `pnpm lint` runs, **Then** it
   reports nothing for `engine.spec.ts`.
2. **Given** the same spec, **When** it runs, **Then** the same 73 tests pass
   as before the change.

### Requirements

- **FR-001** `eslint.config.mjs` MUST NOT exempt any core file from the
  type-checked rules (← maintainer)
- **FR-002** The spec's mocks MUST carry the signatures of what they stand in
  for, not `any` (← maintainer)
- **FR-003** No assertion in the spec MAY change (← maintainer)

### Edge cases

- `expect.any(...)` and `expect.stringContaining(...)` return `any` → cast to
  `string`, the idiom `merge.spec.ts` already uses (FR-002, T002)

### Definition of Done

- **SC-001** `pnpm lint` clean with the override removed
- **SC-002** `engine.spec.ts`: 73 tests before, 73 after, all green
- [x] every FR has a test that failed before the code made it pass — the lint
      run is the test: 42 errors before, 0 after
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001] Remove the `engine.spec.ts` override — `eslint.config.mjs`
- [x] T002 [FR-002, FR-003] Type `auth` as
      `{ [K in keyof CookieAuthApi]: Mock<CookieAuthApi[K]> }` and `send` as
      `Mock<Transport>`; drop the casts that became unnecessary; cast the
      asymmetric matchers — `packages/client-core/src/engine.spec.ts`
- **Checkpoint:** lint clean, 73/73 green, the spec type-checks under the
  core's `tsconfig.json`.

### Notes

The old `auth` type intersected `ReturnType<typeof vi.fn>` with
`CookieAuthApi`. The intersection carried the interface's method syntax, which
is what `unbound-method` reported 14 times, and the untyped `Mock<Procedure>`
made every `mockImplementation(() => promise)` a `no-misused-promises`. Typing
the two mocks removed 37 of the 42 errors; no `eslint-disable` was needed.
