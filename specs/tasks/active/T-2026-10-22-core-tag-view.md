## T-2026-10-22-core-tag-view — Give the navigation a tag entry with a count

- Created: 2026-10-22
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: [TUI UX redesign design](../../../docs/specs/2026-10-22-tui-ux-redesign-design.md),
  Q6; [plan](../../../docs/plans/2026-10-22-plan-tui-ux-redesign.md), PR 0
- Plan: [docs/plans/2026-10-22-plan-tui-ux-redesign.md](../../../docs/plans/2026-10-22-plan-tui-ux-redesign.md),
  Tasks 0.1 and 0.2

### Goal

The TUI sidebar lists tags with a task count, as the web sidebar lists
projects. `watch.view` resolves no tag key and `catalog.nav` carries no tag
entry, so a client would have to filter the replica a second time. A tag is a
plain `{tag: id}` filter the core already evaluates; the engine needs to name
and count it, and the web navigation to show it.

### Scenarios

1. **Given** two tasks tagged `@home`, one of them closed, **When** a tab
   watches `tag:<id>`, **Then** only the open one arrives, in any layout.
2. **Given** a tag that does not exist or was deleted, **When** a tab watches
   `tag:<id>`, **Then** the view is published as `deleted`.
3. **Given** projects and tags, **When** the catalog is read, **Then** `nav`
   lists `all`, `today`, `upcoming`, the projects, then the tags, each with
   its count.
4. **Given** a task detached from a tag, **When** the next publish happens,
   **Then** the tag's count drops by one.
5. **Given** a task `milk @home`, **When** the web user clicks `home` in the
   sidebar, **Then** the URL is `/tags/<id>`, the list shows `milk` and the
   badge is 1.

### Requirements

- **FR-001** `watch.view` MUST accept `tag:<id>` of a live tag and resolve it
  to `{tag: id}`, sorted `manual`, layout `list`; an unknown or deleted tag is
  published as `deleted` (← design Q6; `project:<id>` precedent)
- **FR-002** `catalog.nav` MUST list one `tag:<id>` entry per live tag after
  the project entries, in `catalog.tags` order, each count the number of open
  tasks its filter yields, subtasks included, each task once (← Q6)
- **FR-003** The web navigation MUST map `tag:<id>` to `/tags/<id>` and back,
  name the entry from `catalog.tags`, and leave out a tag missing there (←
  Q6; the project precedent)
- **FR-004** The web MUST show tag entries in the sidebar under their own
  group and open their page, which watches `tag:<id>` (← Q6)

### Edge cases

- `tag:<id>` of an unknown or deleted tag → `deleted` (FR-001, T001)
- No tags → `nav` is unchanged (FR-002, T001)
- Tag missing from `catalog.tags` → no navigation entry (FR-003, T003)

### Definition of Done

- **SC-001** A client renders tag entries with counts and opens any of them,
  reading only what the engine publishes.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002] `TAG_PREFIX`, `tagView`, the `builtInView` branch,
  `viewSpec` and the `nav` entries — `packages/client-core/src/engine-protocol.ts`,
  `operations.ts`, `engine.ts`, `engine.spec.ts`
- [x] T002 [FR-001, FR-002] Docs: the views design names the key and the
  entries — `docs/specs/2026-10-01-views-design.md`
- [x] T003 [FR-003] `navEntries`, `navPath`, `routeKey`, `isBuiltIn` —
  `apps/web/app/utils/nav.ts`, `nav.spec.ts`
- [x] T004 [FR-004] `pages/tags/[id].vue`, the tags group in `ViewNav`, e2e —
  `apps/web/app`, `apps/web/e2e/nav.spec.ts`
- [x] T005 [FR-004] Docs: the Navigation row — `docs/design/DESIGN.md`
- **Checkpoint:** the web sidebar lists tags with the core's counts.
