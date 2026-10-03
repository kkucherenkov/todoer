# Plan: lint and typecheck the web as strictly as the rest

**Goal:** `apps/web` lints with `recommendedTypeChecked` (`.ts` and `.vue`)
and compiles with `tsconfig.base.json`'s flags, like every other package.

**Task spec:** `specs/tasks/active/T-2026-10-03-web-strict-types.md`

**Architecture:** One root flat config stays the single source of rules.
`@nuxt/eslint` is a Nuxt module: on `nuxt prepare` (the web's `postinstall`)
it writes `.nuxt/eslint.config.mjs`, a `withNuxt()` that sets up
`vue-eslint-parser` with typescript-eslint's parser, eslint-plugin-vue,
Nuxt's rules and the auto-import globals. Its globs are relative to the web
(`app/pages/**`), so the root config extends it under `basePath: 'apps/web'`,
which `defineConfig` passes down to every extended config. The root's
`recommendedTypeChecked` and `projectService` then reach `.vue` files too;
`extraFileExtensions: ['.vue']` comes from the Nuxt config.

**Why not `disableTypeChecked`:** it was there because the project service
could not see Nuxt's generated types. It can: `apps/web/tsconfig.json` is a
solution-style config whose references the TS server follows. What it cannot
see without a build is `@todoer/client-core`'s `dist/`, and turbo's `lint`
already depends on `^build`.

## Task 1: ESLint

- `pnpm --filter @todoer/web add -D @nuxt/eslint`
- `nuxt.config.ts`: `'@nuxt/eslint'` in `modules`
- `eslint.config.mjs`: import `withNuxt` from
  `./apps/web/.nuxt/eslint.config.mjs`; replace the web's
  `disableTypeChecked` block with
  `{ basePath: 'apps/web', extends: [await withNuxt()] }`

The root config now needs `nuxt prepare` to have run, which `pnpm install`
does.

## Task 2: TypeScript

Nuxt 4 already sets `strict` and `noUncheckedIndexedAccess`. Add
`exactOptionalPropertyTypes` through `typescript.tsConfig` (app),
`typescript.sharedTsConfig` and `typescript.nodeTsConfig`. The web has no
`server/`, so Nitro's context is left alone.

`vitest.config.ts` and `playwright.config.ts` are in no Nuxt context, so the
project service cannot parse them: `nodeTsConfig.include` adds both, and
`e2e/tsconfig.json` stops including `playwright.config.ts`.

## Task 3: Fix the errors

26 lint errors and 3 type errors. Each fix keeps behaviour; where a rule
flags intended code (a floating promise handed to a DOM event, for instance),
the fix states the intent (`void`) rather than disabling the rule.

## Task 4: Docs

- README "Conventions": `pnpm lint` claim becomes true; mention `.vue`.
- `docs/specs/2026-10-01-client-shells-design.md`, W2 departure 3: note that
  this task closed it.
