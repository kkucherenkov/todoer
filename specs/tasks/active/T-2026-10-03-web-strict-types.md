## T-2026-10-03-web-strict-types — Lint and typecheck the web as strictly as the rest

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: maintainer request, 2026-10-03 — strict TypeScript everywhere;
  `@nuxt/eslint` chosen by the maintainer
- Plan: [docs/plans/2026-10-03-plan-web-strict-types.md](../../../docs/plans/2026-10-03-plan-web-strict-types.md)

### Goal

Every package but the web lints with typescript-eslint's
`recommendedTypeChecked` and compiles with `tsconfig.base.json`'s flags. The
web gets `disableTypeChecked`, its 30 `.vue` files are not linted at all, and
Nuxt's generated tsconfigs lack `exactOptionalPropertyTypes`. The web is where
the next redesign lands, so it should be held to the same bar before that work
starts, not after.

State on `main` (a057d2d), measured before the change:

- `eslint .` in `apps/web` lints 44 files, none of them `.vue`, all with
  `disableTypeChecked`.
- `.nuxt/tsconfig.{app,server,shared,node}.json`: `strict` and
  `noUncheckedIndexedAccess` are already `true` (Nuxt 4's defaults);
  `exactOptionalPropertyTypes` is unset.

### Scenarios

1. **Given** a `.vue` or `.ts` file in `apps/web` with a floating promise,
   **When** `pnpm lint` runs, **Then** it fails on that file.
2. **Given** a component passing `string | undefined` to an optional prop,
   **When** `pnpm --filter @todoer/web typecheck` runs, **Then** it fails.
3. **Given** this branch, **When** a person signs in, adds, marks, drags and
   edits tasks, **Then** everything behaves as on `main`.

### Requirements

- **FR-001** ESLint MUST lint `apps/web`'s `.ts` and `.vue` files with
  `recommendedTypeChecked`, in the root flat config (← maintainer)
- **FR-002** The web's Vue parser and Vue/Nuxt rules MUST come from
  `@nuxt/eslint` (← maintainer)
- **FR-003** Nuxt's app, shared and node contexts MUST compile with `strict`,
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (← maintainer)
- **FR-004** Fixing the new errors MUST NOT change behaviour or UI (←
  maintainer; the web redesign follows)

### Edge cases

- `vitest.config.ts`, `playwright.config.ts` are outside every Nuxt context →
  they join the node context so the project service and `nuxt typecheck` see
  them (FR-001, FR-003, T004)
- `packages/client-core/src/engine.spec.ts` keeps its `disableTypeChecked`
  exemption; another task owns it (tuxedo 429)
- `@nuxt/eslint`'s own rules go beyond `recommendedTypeChecked` (eslint-plugin-
  vue's recommended set, `import/no-duplicates`, nine non-type-aware
  typescript-eslint rules). They stay: the web's rule set is a superset of the
  core's, measured with `eslint --print-config` (FR-001)

### Definition of Done

- **SC-001** `pnpm lint` passes with type-aware rules on `apps/web/**/*.{ts,vue}`
- **SC-002** `pnpm --filter @todoer/web typecheck` passes with the stricter flags
- **SC-003** web unit tests and the Playwright suite pass
- [ ] every FR has a test that failed before the code made it pass — the lint
      and typecheck runs are the tests: both fail on `main`'s code with this
      configuration (26 lint errors, 3 type errors)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002] Add `@nuxt/eslint`, register the module, extend
      its generated config from the root config under `basePath: 'apps/web'`,
      drop the web's `disableTypeChecked` — plan Task 1
- [x] T002 [FR-003] `typescript.{tsConfig,sharedTsConfig,nodeTsConfig}` set
      `exactOptionalPropertyTypes` — plan Task 2
- [x] T003 [FR-004] Fix every lint and type error without a behaviour change —
      plan Task 3
- [x] T004 [FR-001, FR-003] Config files into the node context — plan Task 2
- [x] T005 Docs: README, client shells design departure 3 — plan Task 4
- **Checkpoint:** lint, typecheck, unit and e2e green

### Departures

1. **`noUncheckedIndexedAccess` needed no setting.** The brief asked for it in
   every context; Nuxt 4 already sets it, so only
   `exactOptionalPropertyTypes` is added.
2. **One DOM change without a visual one.** `pages/views/[id].vue` had two
   roots, which `@nuxt/eslint` refuses in pages (route transitions need one).
   The wrapper is `<div class="contents">`: `display: contents` keeps both
   children in `UDashboardPanel`'s flex column, laid out as before.
3. **The web's rule set is wider than the core's**, by what `@nuxt/eslint`
   brings (see Edge cases). Three of its errors were fixed in place
   (`no-dynamic-delete`, `no-extraneous-class`, `no-invalid-void-type`)
   rather than turning the rules off.
4. **`playwright.config.ts` moved from `e2e/tsconfig.json` to Nuxt's node
   context**, so the project service finds it; `tsc -p e2e` no longer
   compiles it, `nuxt typecheck` does.

### Open questions

—
