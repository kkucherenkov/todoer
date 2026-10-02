## T-2026-10-02-open-design-kit — Write the design system and the Open Design kit for the web redesign

- Created: 2026-10-02
- Owner: claude
- Status: done
- Blockers: —
- Spec: maintainer request, 2026-10-02 — an Open Design kit for the web
  client's redesign: calm, dense working tool, neutral grey with one accent,
  system fonts, keyboard-first, light and dark, Nuxt UI 4 tokens only;
  `docs/specs/2026-10-01-client-shells-design.md` ("Visual design": Nuxt UI
  components, theme changed through tokens only)
- Plan: none; the steps below are the whole change
- Completed: 2026-10-02
- Result: https://github.com/kkucherenkov/todoer/pull/23

### Goal

The web client runs on Nuxt UI's default theme (green on slate) with no
written design system. The maintainer wants a redesign generated with Open
Design, a local tool that drives Claude Code as a design engine. Its output is
only useful if it arrives in a form the repository can absorb: Nuxt UI
semantic colours and `--ui-*` variables, Vue SFCs on Nuxt UI components, and
mockups that leave behaviour and the Playwright suite's selectors alone. This
task writes the design system, the per-screen prompts and the way back into
the repository, and installs the matching skill and design system into the
local Open Design checkout. It changes no application code.

### Scenarios

1. **Given** the Open Design checkout at `~/projects/petProjects/tools/open-design`,
   **When** the maintainer follows `docs/design/open-design/README.md`,
   **Then** Open Design starts, lists the `todoer` design system and the
   `todoer-repo-bundle` skill, and accepts the first prompt (tokens).
2. **Given** a generated screen, **When** the maintainer reads the reconcile
   section, **Then** they know where each output file goes in the repository
   and which selectors, roles and labels must survive.
3. **Given** `docs/design/DESIGN.md`, **When** someone styles a component,
   **Then** every colour, size and state they need is named as a Nuxt UI token
   or an app config setting, with light and dark values.

### Requirements

- **FR-001** `docs/design/DESIGN.md` MUST describe the todoer design system in
  Open Design's `DESIGN.md` form (at least seven H2 sections): product
  context, principles, palette for light and dark with semantic roles
  (priority p1–p4, status columns, sync states), typography, spacing and
  density, radius, elevation, motion, iconography, the component inventory
  mapped to Nuxt UI components, accessibility and states (← maintainer)
- **FR-002** Every value in FR-001 MUST map onto Nuxt UI 4 theming: semantic
  colours in `app.config.ts`, `--ui-*` variables in `main.css`, component
  settings under `ui` in `app.config.ts`; no new UI dependency (← maintainer;
  client-shells design "Visual design")
- **FR-003** `docs/design/open-design/README.md` MUST say how to run Open
  Design locally with the exact commands, how to select the design system and
  the skill, and give one prompt per screen of the real app, each asking for
  every state and both themes, tokens first (← maintainer)
- **FR-004** The README MUST have a reconcile section: where tokens, mockups
  and SFCs land, and what must not change, with the e2e selectors, roles and
  labels the Playwright suite relies on (← maintainer)
- **FR-005** The skill `todoer-repo-bundle` and the design system `todoer`
  MUST be installed into the Open Design checkout (outside the repository),
  and the README MUST say whether the tool needs a restart to see them
  (← maintainer)
- **FR-006** Contrast claims in `DESIGN.md` MUST be computed from the actual
  palette values, not asserted (← maintainer: contrast AA)

### Edge cases

- The W5 screens (subtasks, recurrence dialog, delete confirm) are not on
  `main` yet → the README marks them as W5 and describes them from
  `docs/plans/2026-10-02-plan-w5-web-task-editing.md` and the branch
  (FR-003, T004)
- Open Design's daemon is on Node 24 and the system Node is newer → the
  README gives the nvm path (FR-003, T004)
- A token value that fails AA on one surface (muted text on elevated grey) →
  `DESIGN.md` names the pair and the rule that avoids it (FR-006, T002)

### Definition of Done

- **SC-001** `docs/design/DESIGN.md`, `docs/design/tokens.css` and
  `docs/design/open-design/README.md` exist and agree on every value
- **SC-002** the skill and design system are present under
  `tools/open-design/skills/todoer-repo-bundle/` and
  `tools/open-design/design-systems/todoer/`, and the daemon's listing code
  reads them on each request
- [x] every FR has a test that failed before the code made it pass —
      documentation only; checked instead by a WCAG contrast script over
      Tailwind 4's oklch palette (FR-006) and by running the daemon's own
      `listDesignSystems` and `listSkills` on the installed files, which
      return `todoer` and `todoer-repo-bundle` (mode prototype) (FR-005)
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002] Record the current token surface: `nuxt.config.ts`,
      `main.css`, no `app.config.ts`, Nuxt UI 4.11.3 defaults — `apps/web`
- [x] T002 [FR-001, FR-002, FR-006] Write the design system and its compiled
      tokens — `docs/design/DESIGN.md`, `docs/design/tokens.css`
- [x] T003 [FR-004] Collect the selectors, roles, labels and classes the e2e
      suite reads — `apps/web/e2e/*.spec.ts`, W5's `editing.spec.ts`
- [x] T004 [FR-003, FR-004, FR-005] Write the Open Design README —
      `docs/design/open-design/README.md`
- [x] T005 [FR-005] Install the skill and the design system package —
      `tools/open-design/skills/todoer-repo-bundle/SKILL.md`,
      `tools/open-design/design-systems/todoer/`
- [x] T006 [FR-003] Point the README's layout table at `docs/design/` —
      `README.md`
- **Checkpoint:** the kit is in the repository, the tool sees it, Prettier
  passes

### Open questions

- none blocking; the ones for the maintainer are listed at the end of
  `docs/design/open-design/README.md`
