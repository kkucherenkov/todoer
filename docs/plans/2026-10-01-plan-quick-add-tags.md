# Quick-add Projects and Tags as Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `todoer add` stores `#project` and `@tag` as rows, `list` shows and
filters by them, and a client merges duplicate names that two offline devices
created.

**Architecture:** one shared name function in `@todoer/specs`; in
`apps/cli/src` two pure modules — `labels.ts` (resolve names to rows, read a
task's labels) and `merge.ts` (plan the merge of duplicates) — wired into
`run.ts`: `add` queues the label creates, the task and its TaskTags as one
atomic batch through a `submit` that takes several operations; `list` filters
and prints labels; every command that reached the server queues the merge.
No server change.

**Tech Stack:** TypeScript, Node ≥ 24.15, Vitest 5. No new dependencies.

**Spec:** [`docs/specs/2026-09-28-quick-add-tags-projects-design.md`](../specs/2026-09-28-quick-add-tags-projects-design.md)
— read all of it before Task 1. Background: ADR 0005, ADR 0007, and the
TaskTag rules of plan C2 (derived id, `attached` toggle). Task spec:
[`specs/tasks/active/T-2026-10-01-quick-add-tags.md`](../../specs/tasks/active/T-2026-10-01-quick-add-tags.md).

## Where this plan departs from the design doc

Task 7 records them in the design doc.

1. **Only server-confirmed rows are merged.** A row has a `version` once the
   server has sent it; a tag still pending in the outbox has none. A loser
   cannot be deleted without a `baseVersion`, and a pending row may still
   arrive as someone else's duplicate, so the merge ignores rows without a
   numeric `version`. Quick-add still reuses a pending tag by name.
2. **A tag named twice in one add (`@a @A`) is one tag and one TaskTag.**
3. **Created labels and queued merges are reported on stderr**
   (`note: created @phone`, `note: merging duplicate @phone (2) — sent with
   the next command`); stdout and `--json` keep their shape apart from the new
   `project` and `tags` fields.
4. **A pair of duplicates attached to one task shows once**, spelled as the
   lowest-id tag spells it.

## Global Constraints

- **Name key:** `name.normalize('NFC').toLowerCase()`; stored spelling kept as
  typed. Exported from `@todoer/specs` as `nameKey`.
- **Stored names:** `@phone` → tag `name: '@phone'`; `#finance` → project
  `name: 'finance'`, `rank: 'a0'`.
- **Matching pools:** tags with `deletedAt === null`; projects with
  `deletedAt === null` and no `archivedAt`. Winner = lowest id
  (lower-cased string compare).
- **TaskTag:** id `taskTagId(taskId, tagId)`, fields `{ taskId, tagId }` on
  add; a merge writes `{ taskId, tagId, attached: true }` and detaches the old
  link with `set attached false`. A link counts only when `deletedAt === null`
  and `attached !== false`.
- **Merge ops** are queued after a successful pull and never sent by the
  command that queued them.
- **CLI tests:** `pnpm --filter @todoer/cli test` (TZ=UTC, clock
  2026-09-26T10:00Z). After touching `packages/specs`:
  `pnpm --filter @todoer/specs build` first.
- **Commits:** Conventional Commits with a scope, body says why, **no
  `Co-Authored-By` trailer**; `pnpm format` first; never commit to `main`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **Case and composition.** `@Phone` after `@phone` reuses the tag; a
   decomposed `é` matches a composed one. Tests in Task 1 and Task 2.
2. **A task added offline with a new tag, then another add with the same tag
   before any sync.** The second add must reuse the pending tag, not create a
   second one. Test in Task 3.
3. **Merging must converge and stop.** After the merge ops are sent, the next
   pull finds no duplicates and queues nothing more. Test in Task 6.
4. **A detached link is not resurrected by the merge**, and an archived
   project is never folded into a live one. Tests in Task 5.
5. **One refused operation fails the whole add's exit code**, even when it is
   the tag create and not the task. Test in Task 3.

---

### Task 0: Branch and documents

- [ ] **Step 1:** on branch `feat/quick-add-tags` (already created from
      `main`, carrying the design doc commit).
- [ ] **Step 2: Commit**

```bash
git add docs/plans/2026-10-01-plan-quick-add-tags.md specs/tasks/active/T-2026-10-01-quick-add-tags.md
git commit -m "docs: plan quick-add projects and tags as rows" \
  -m "Implements the #362 design: names resolved and created by quick-add,
labels in list, and an automatic merge of duplicate names."
```

---

### Task 1: The name key

Implements FR-001 (T001).

**Files:**

- Create: `packages/specs/src/names.ts`, `packages/specs/src/names.spec.ts`,
  `packages/specs/vectors/names.json`
- Modify: `packages/specs/src/index.ts`

**Interfaces:** Produces `nameKey(name: string): string` from `@todoer/specs`.

- [ ] **Step 1: The vectors**

`packages/specs/vectors/names.json`:

```json
{
  "source": "The name rule of docs/specs/2026-09-28-quick-add-tags-projects-design.md (Q4): equal after NFC normalisation and lower-casing.",
  "cases": [
    { "a": "@phone", "b": "@Phone", "same": true },
    { "a": "@café", "b": "@café", "same": true },
    { "a": "@Über", "b": "@über", "same": true },
    { "a": "@to-do", "b": "@todo", "same": false },
    { "a": "finance", "b": "finances", "same": false }
  ]
}
```

- [ ] **Step 2: The failing test** — `packages/specs/src/names.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nameKey } from './names';

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/names.json', import.meta.url), 'utf8'),
) as { cases: Array<{ a: string; b: string; same: boolean }> };

describe('nameKey', () => {
  it.each(vectors.cases)('$a vs $b → same: $same', ({ a, b, same }) => {
    expect(nameKey(a) === nameKey(b)).toBe(same);
  });

  it('keeps the characters, only folding case and composition', () => {
    expect(nameKey('@Phone')).toBe('@phone');
  });
});
```

Run `pnpm --filter @todoer/specs test` — FAIL: `./names` does not resolve.

- [ ] **Step 3: Implement** — `packages/specs/src/names.ts`:

```ts
/**
 * The form in which two tag or project names are compared (quick-add
 * design, Q4): NFC, so a composed and a decomposed `é` agree, then lower
 * case, so `@Phone` and `@phone` are one tag. The stored spelling is never
 * changed. Every client compares names through this, or they disagree
 * about which rows are duplicates.
 */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}
```

Add `export * from './names';` to `packages/specs/src/index.ts`.

- [ ] **Step 4:** `pnpm --filter @todoer/specs test && pnpm --filter @todoer/specs build && pnpm --filter @todoer/specs lint` — PASS.
      Mutation: drop `.normalize('NFC')` — the `café` case must fail.
- [ ] **Step 5: Commit** (`pnpm format` first):
      `git add packages/specs && git commit -m "feat(specs): compare tag and project names one way" -m "Duplicate detection only converges if every client folds names the same way, so the rule is shared, like the rrule parser."`
      Tick T001.

---

### Task 2: Resolving names and reading labels

Implements FR-002, FR-004 (T002). Departures 2 and 4.

**Files:** Create `apps/cli/src/labels.ts`, `apps/cli/src/labels.spec.ts`.

**Interfaces:**

- Consumes: `nameKey`, type `OpCreate` from `@todoer/specs`; `Row` from
  `./store.js`.
- Produces:
  - `liveTags(tags: Row[]): Row[]`, `liveProjects(projects: Row[]): Row[]`
  - `compareIds(a: Row, b: Row): number`, `winner(rows: Row[]): Row | undefined`
  - `isAttached(link: Row): boolean`
  - `type Labels = { projectId: string | null; tagIds: string[]; creates: OpCreate[]; created: string[] }`
  - `resolveLabels(wanted: { project: string | undefined; tags: string[] }, rows: { projects: Row[]; tags: Row[] }, newId: () => string, ts: string): Labels`
  - `labelsOf(task: Row, rows: { projects: Row[]; tags: Row[]; links: Row[] }): { project: string | null; tags: string[] }`

- [ ] **Step 1: The failing test** — `apps/cli/src/labels.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { labelsOf, resolveLabels, winner } from './labels.js';

function ids() {
  let n = 0;
  return () => `n${String(++n)}`;
}

describe('winner', () => {
  it('is the lowest id, case-insensitively', () => {
    expect(winner([{ id: 'B2' }, { id: 'a9' }, { id: 'b1' }])?.id).toBe('a9');
  });
});

describe('resolveLabels', () => {
  const tags = [
    { id: 'b', name: '@PHONE', deletedAt: null },
    { id: 'a', name: '@phone', deletedAt: null },
    { id: 'z', name: '@gone', deletedAt: '2026-09-01T00:00:00Z' },
  ];

  it('reuses a tag by name key, picking the lowest id among duplicates', () => {
    const labels = resolveLabels({ project: undefined, tags: ['@Phone'] }, { projects: [], tags }, ids(), 'T');
    expect(labels).toEqual({ projectId: null, tagIds: ['a'], creates: [], created: [] });
  });

  it('creates an unknown tag, and a deleted one counts as unknown', () => {
    const labels = resolveLabels({ project: undefined, tags: ['@gone'] }, { projects: [], tags }, ids(), 'T');
    expect(labels.tagIds).toEqual(['n1']);
    expect(labels.creates).toEqual([
      { opId: 'n2', kind: 'create', table: 'tag', id: 'n1', fields: { name: '@gone' }, ts: 'T' },
    ]);
    expect(labels.created).toEqual(['@gone']);
  });

  it('counts a tag named twice in one add once', () => {
    const labels = resolveLabels({ project: undefined, tags: ['@home', '@Home'] }, { projects: [], tags: [] }, ids(), 'T');
    expect(labels.tagIds).toEqual(['n1']);
    expect(labels.creates).toHaveLength(1);
  });

  it('ignores an archived project and creates a new one', () => {
    const projects = [{ id: 'p0', name: 'finance', archivedAt: '2026-01-01T00:00:00Z', deletedAt: null }];
    const labels = resolveLabels({ project: 'finance', tags: [] }, { projects, tags: [] }, ids(), 'T');
    expect(labels.projectId).toBe('n1');
    expect(labels.creates[0]).toMatchObject({ table: 'project', id: 'n1', fields: { name: 'finance', rank: 'a0' } });
    expect(labels.created).toEqual(['#finance']);
  });

  it('reuses a live project', () => {
    const projects = [{ id: 'p1', name: 'Finance', archivedAt: null, deletedAt: null }];
    expect(resolveLabels({ project: 'finance', tags: [] }, { projects, tags: [] }, ids(), 'T').projectId).toBe('p1');
  });
});

describe('labelsOf', () => {
  const rows = {
    projects: [{ id: 'p', name: 'finance', deletedAt: null }],
    tags: [
      { id: 'b', name: '@Phone', deletedAt: null },
      { id: 'a', name: '@phone', deletedAt: null },
      { id: 'c', name: '@home', deletedAt: null },
      { id: 'd', name: '@desk', deletedAt: '2026-09-01T00:00:00Z' },
    ],
    links: [
      { taskId: 't', tagId: 'b', deletedAt: null },
      { taskId: 't', tagId: 'a', deletedAt: null },
      { taskId: 't', tagId: 'c', deletedAt: null, attached: false },
      { taskId: 't', tagId: 'd', deletedAt: null },
      { taskId: 'u', tagId: 'c', deletedAt: null },
    ],
  };

  it("lists a task's project and attached live tags, a duplicate pair once in the winner's spelling", () => {
    expect(labelsOf({ id: 't', projectId: 'p' }, rows)).toEqual({ project: 'finance', tags: ['@phone'] });
  });

  it('has no project for a task without one or with a deleted one', () => {
    expect(labelsOf({ id: 'u', projectId: null }, rows)).toEqual({ project: null, tags: ['@home'] });
  });
});
```

Run `pnpm --filter @todoer/cli exec vitest run src/labels.spec.ts` — FAIL:
`./labels.js` does not resolve.

- [ ] **Step 2: Implement** — `apps/cli/src/labels.ts`:

```ts
import { nameKey, type OpCreate } from '@todoer/specs';
import type { Row } from './store.js';

/** Tags quick-add and `list` can see: not deleted. */
export function liveTags(tags: Row[]): Row[] {
  return tags.filter((tag) => tag.deletedAt === null);
}

/** Projects in play: not deleted and not archived — an archived project is
 *  never matched or merged (quick-add design, Q5 and Q8). */
export function liveProjects(projects: Row[]): Row[] {
  return projects.filter(
    (project) =>
      project.deletedAt === null &&
      (project.archivedAt === null || project.archivedAt === undefined),
  );
}

function idOf(row: Row): string {
  return String(row.id).toLowerCase();
}

/** Orders rows by id, lowest first. */
export function compareIds(a: Row, b: Row): number {
  return idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0;
}

/** Among rows sharing a name, the one every client picks: the lowest id
 *  (quick-add design, Q7). */
export function winner(rows: Row[]): Row | undefined {
  return [...rows].sort(compareIds)[0];
}

function named(pool: Row[], name: string): Row[] {
  const key = nameKey(name);
  return pool.filter(
    (row) => typeof row.name === 'string' && nameKey(row.name) === key,
  );
}

/** A TaskTag that ties its task to its tag: live, and not detached. */
export function isAttached(link: Row): boolean {
  return link.deletedAt === null && link.attached !== false;
}

export type Labels = {
  projectId: string | null;
  tagIds: string[];
  /** Creates for the names nothing matched, in the order to queue them. */
  creates: OpCreate[];
  /** What was created, as the caller typed it, for stderr. */
  created: string[];
};

/**
 * The rows a quick-add's `#project` and `@tags` mean. A name matches by name
 * key; among duplicates the lowest id wins; an unknown name becomes a create
 * (quick-add design, Q1, Q3). `@phone` is stored as `@phone`, `#finance` as
 * `finance` (Q2). A tag named twice counts once (plan departure 2).
 */
export function resolveLabels(
  wanted: { project: string | undefined; tags: string[] },
  rows: { projects: Row[]; tags: Row[] },
  newId: () => string,
  ts: string,
): Labels {
  const creates: OpCreate[] = [];
  const created: string[] = [];
  const create = (
    table: 'project' | 'tag',
    fields: Record<string, unknown>,
  ): string => {
    const id = newId();
    creates.push({ opId: newId(), kind: 'create', table, id, fields, ts });
    return id;
  };

  let projectId: string | null = null;
  if (wanted.project !== undefined) {
    const found = winner(named(liveProjects(rows.projects), wanted.project));
    if (found !== undefined) {
      projectId = String(found.id);
    } else {
      projectId = create('project', { name: wanted.project, rank: 'a0' });
      created.push(`#${wanted.project}`);
    }
  }

  const tagIds: string[] = [];
  const seen = new Set<string>();
  for (const name of wanted.tags) {
    const key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const found = winner(named(liveTags(rows.tags), name));
    if (found !== undefined) {
      tagIds.push(String(found.id));
    } else {
      tagIds.push(create('tag', { name }));
      created.push(name);
    }
  }
  return { projectId, tagIds, creates, created };
}

/**
 * A task's project name and its attached tags' names, sorted by name key.
 * Two duplicate tags on one task show once, spelled as the lowest-id one
 * spells it (plan departure 4).
 */
export function labelsOf(
  task: Row,
  rows: { projects: Row[]; tags: Row[]; links: Row[] },
): { project: string | null; tags: string[] } {
  const project = rows.projects.find(
    (row) => row.id === task.projectId && row.deletedAt === null,
  );
  const attached = new Set(
    rows.links
      .filter((link) => link.taskId === task.id && isAttached(link))
      .map((link) => String(link.tagId)),
  );
  const names = new Map<string, string>();
  for (const tag of [...liveTags(rows.tags)].sort(compareIds)) {
    if (!attached.has(String(tag.id)) || typeof tag.name !== 'string') {
      continue;
    }
    const key = nameKey(tag.name);
    if (!names.has(key)) names.set(key, tag.name);
  }
  return {
    project:
      project !== undefined && typeof project.name === 'string'
        ? project.name
        : null,
    tags: [...names.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, name]) => name),
  };
}
```

- [ ] **Step 3:** `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint` — PASS.
      Mutations (revert each): `liveProjects` stops checking `archivedAt` —
      "ignores an archived project" fails; drop `seen` — "counts a tag named
      twice" fails; sort `liveTags(rows.tags)` in reverse — the winner's
      spelling test fails.
- [ ] **Step 4: Commit:** `git add apps/cli/src/labels.ts apps/cli/src/labels.spec.ts && git commit -m "feat(cli): resolve quick-add names to tags and projects" -m "Names match by the shared key and the lowest id wins, so every client picks the same row among duplicates; unknown names become creates."`
      Tick T002.

---

### Task 3: `add` stores the markers

Implements FR-003, FR-005 (T003). Departure 3.

**Files:** Modify `apps/cli/src/parse-quick-add.ts`,
`apps/cli/src/parse-quick-add.spec.ts`, `apps/cli/src/run.ts`,
`apps/cli/src/run.spec.ts`.

**Interfaces:**

- Consumes: `resolveLabels` (Task 2); `taskTagId` from `@todoer/specs`.
- Produces: `planAdd(text)` returns `{ title, priority, project, tags }`
  (no `notice`); `submit(store, send, ops: OpCreate[], command)` — enqueues
  every op in one store transaction and treats every one as the command's own;
  helpers `projects(store)`, `tagRows(store)`, `links(store)` in `run.ts`
  (overlaid views of `project`, `tag`, `task_tag`).

- [ ] **Step 1: Change `planAdd`'s tests**

In `parse-quick-add.spec.ts`, replace the `describe('planAdd', …)` block's
first test and the two notice tests with:

```ts
  it('carries the fields the ops are built from, markers included', () => {
    expect(planAdd('call the bank @phone #finance p2')).toEqual({
      title: 'call the bank',
      priority: 2,
      project: 'finance',
      tags: ['@phone'],
    });
  });

  it('has no project and no tags when none are given', () => {
    expect(planAdd('buy milk')).toEqual({
      title: 'buy milk',
      priority: 0,
      project: undefined,
      tags: [],
    });
  });
```

(keep the two refusal tests).

- [ ] **Step 2: The failing `run` tests**

In `run.spec.ts`, replace the test "puts planAdd's notice about a dropped
marker on stderr, never stdout" with the block below, and add `taskTagId` to
the `@todoer/specs` import:

```ts
  describe('quick-add markers', () => {
    // Scenario 1.
    it('queues the tag, the project, the task and its TaskTag, in order', async () => {
      const d = deps(unreachable);
      const out = await run(['add', 'call the bank @phone #finance'], d);

      expect(d.store.pending().map((op) => `${op.kind} ${op.table}`)).toEqual([
        'create project',
        'create tag',
        'create task',
        'create task_tag',
      ]);
      const [project, tag, task, link] = d.store.pending();
      expect(project).toMatchObject({ id: 'id-1', fields: { name: 'finance', rank: 'a0' } });
      expect(tag).toMatchObject({ id: 'id-3', fields: { name: '@phone' } });
      expect(task).toMatchObject({ id: 'id-6', fields: { title: 'call the bank', projectId: 'id-1' } });
      expect(link).toMatchObject({ id: taskTagId('id-6', 'id-3'), fields: { taskId: 'id-6', tagId: 'id-3' } });
      expect(out.stderr).toContain('note: created #finance @phone');
      expect(out.stdout).toEqual(['call the bank']);
    });

    // Scenario 2 and Review Focus 2: reuse works on pending rows too.
    it('reuses a tag by name, even one still waiting in the outbox', async () => {
      const d = deps(unreachable);
      await run(['add', 'call the bank @phone'], d);
      await run(['add', 'text mum @Phone'], d);
      const creates = d.store.pending().filter((op) => op.table === 'tag');
      expect(creates).toHaveLength(1);
      const links = d.store.pending().filter((op) => op.table === 'task_tag');
      expect(links.map((op) => (op.kind === 'create' ? op.fields.tagId : null))).toEqual(['id-1', 'id-1']);
    });

    // Review Focus 5: any refused op is the command's failure.
    it('exits 1 when the server refuses the tag create, not only the task', async () => {
      const d = deps((request) =>
        Promise.resolve(
          json({
            cursor: 0,
            results: request.ops.map((op) => ({
              opId: op.opId,
              status: op.table === 'tag' ? ('rejected' as const) : ('applied' as const),
              ...(op.table === 'tag' ? { reason: 'nope' } : {}),
            })),
            changes: [],
          }),
        ),
      );
      await expect(run(['add', 'x @phone'], d)).rejects.toThrow(RefusalError);
    });

    it('says nothing about markers when there are none', async () => {
      const d = deps(fakeServer().send);
      const out = await run(['add', 'buy milk'], d);
      expect(out.stderr).toEqual([]);
    });
  });
```

The ids follow `deps`'s counter: `resolveLabels` mints project id 1, its op 2,
tag id 3, its op 4; the task takes op 5, id 6; the TaskTag op 7.

Run `pnpm --filter @todoer/cli exec vitest run src/run.spec.ts src/parse-quick-add.spec.ts` —
FAIL (markers dropped, notice still printed).

- [ ] **Step 3: `planAdd`**

Replace `planAdd` and its doc comment in `parse-quick-add.ts`:

```ts
/**
 * What `add` is going to send: the title, the priority, and the names of the
 * project and tags the markers ask for. Refuses text that leaves no title —
 * `todoer add "#groceries"` once created a task with no title at all.
 * Resolving the names to rows is `labels.ts`'s job.
 */
export function planAdd(text: string): {
  title: string;
  priority: number;
  project: string | undefined;
  tags: string[];
} {
  const parsed = parseQuickAdd(text);
  if (parsed.title === '') {
    throw new UsageError(
      `no title in ${JSON.stringify(text)} — #project and @tag markers do not make one`,
    );
  }
  return {
    title: parsed.title,
    priority: parsed.priority,
    project: parsed.project,
    tags: parsed.tags,
  };
}
```

- [ ] **Step 4: `submit` takes several operations**

In `run.ts` replace `submit` and `flushOwn`:

```ts
/**
 * Queues the operations the running command minted, in one transaction and in
 * order, and sends them: stored before they are sent, so every attempt
 * carries their ids (ADR 0015 §4). Every one counts as the command's own, so
 * a refusal of any of them is the command's exit 1. Returns whether the
 * server has all of them.
 */
async function submit(
  store: Store,
  send: Transport,
  ops: OpCreate[],
  command: string,
): Promise<boolean> {
  store.transaction(() => {
    for (const op of ops) store.enqueue(op);
  });
  const opIds = ops.map((op) => op.opId);
  const flushed = await flushOwn(store, send, opIds, command);
  let settled = true;
  for (const opId of opIds) {
    // Evaluated unconditionally, never short-circuited on `flushed.synced`:
    // a batch-refused own op is removed from the outbox (I1) even when the
    // follow-up pull that reports it is itself unreached, and that
    // rejection must still throw rather than be reported as "queued".
    let own = ownOutcome(flushed.results, opId);
    if (own === 'unreported' && flushed.synced) {
      // A parallel invocation may have sent it between the enqueue and this
      // flush's read of the outbox; its entry says what became of it.
      const entry = store.entry(opId);
      if (entry === undefined) own = 'settled';
      else if (entry.status === 'failed') {
        store.remove(opId);
        throw new RefusalError(
          entry.reason ?? 'the server refused this operation',
        );
      }
    }
    if (own !== 'settled') settled = false;
  }
  return flushed.synced && settled;
}

/**
 * A request-level refusal (401, 403, …) leaves the command's operations
 * queued. Said so in the error, because "refused" alone reads as "nothing
 * happened" and a caller who then repeats the command queues it twice.
 */
async function flushOwn(
  store: Store,
  send: Transport,
  opIds: string[],
  command: string,
) {
  try {
    return await flush(store, send, new Set(opIds));
  } catch (error) {
    if (
      error instanceof RefusalError &&
      opIds.some((opId) => store.entry(opId)?.status === 'pending')
    ) {
      const which =
        opIds.length === 1
          ? `operation ${opIds.join('')} is`
          : `operations ${opIds.join(', ')} are`;
      throw new RefusalError(
        `${error.message} — this command's ${which} queued and will be sent once the request is accepted — do not run ${command} again for it`,
      );
    }
    throw error;
  }
}
```

The marking branch's call becomes `submit(store, deps.send, [op], command)`.

- [ ] **Step 5: `add` resolves and queues the markers**

Add to the imports of `run.ts`: `taskTagId` from `@todoer/specs`, and
`import { resolveLabels } from './labels.js';`. In the `add` branch replace
from the `planAdd` call to `human = [title];` with:

```ts
    // Refuses an empty title — see planAdd.
    const { title, priority, project, tags } = planAdd(from.rest.join(' '));
    const ts = deps.now().toISOString();
    const labels = resolveLabels(
      { project, tags },
      { projects: projects(store), tags: tagRows(store) },
      deps.newId,
      ts,
    );
    if (labels.created.length > 0) {
      stderr.push(`note: created ${labels.created.join(' ')}`);
    }
    const op: OpCreate = {
      opId: deps.newId(),
      kind: 'create',
      table: 'task',
      id: deps.newId(),
      fields: {
        title,
        priority,
        rank: 'a0',
        ...(labels.projectId === null ? {} : { projectId: labels.projectId }),
        ...recurrence.fields,
      },
      ts,
    };
    const linkOps: OpCreate[] = labels.tagIds.map((tagId) => ({
      opId: deps.newId(),
      kind: 'create',
      table: 'task_tag',
      id: taskTagId(op.id, tagId),
      fields: { taskId: op.id, tagId },
      ts,
    }));
    synced = await submit(store, deps.send, [...labels.creates, op, ...linkOps], 'add');
    data = tasks(store).find((row) => row.id === op.id) ?? null;
    human = [title];
```

and add next to `tasks()`:

```ts
function projects(store: Store): Row[] {
  return overlay('project', store.rows('project'), store.pending());
}

function tagRows(store: Store): Row[] {
  return overlay('tag', store.rows('tag'), store.pending());
}

function links(store: Store): Row[] {
  return overlay('task_tag', store.rows('task_tag'), store.pending());
}
```

(`links` is used from Task 4 on; if lint objects to it being unused now, add
it in Task 4 instead.)

- [ ] **Step 6:** `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint` — PASS,
      including the existing "keeps the add queued when the token is refused"
      (one op, message unchanged).
      Mutations (revert each): in `submit` drop the `for … opIds` loop and
      read only `opIds.at(-1)` — Review Focus 5 test fails; enqueue the
      TaskTag ops before the task op — the ordering test fails.
- [ ] **Step 7: Commit:** `git add apps/cli/src && git commit -m "feat(cli): store quick-add projects and tags" -m "Markers were parsed and dropped with a note; now the names resolve to rows or are created, and the task and its links are queued with them as one batch whose every operation decides the exit code."`
      Tick T003.

---

### Task 4: `list` shows and filters by labels

Implements FR-006, FR-007 (T004).

**Files:** Modify `apps/cli/src/parse-quick-add.ts` (export the marker
patterns), `apps/cli/src/run.ts`, `apps/cli/src/run.spec.ts`.

**Interfaces:**

- Consumes: `labelsOf` (Task 2), `nameKey`, the `links`/`projects`/`tagRows`
  helpers (Task 3).
- Produces: `list [@tag|#project …] [--json]`; `Due` rows gain
  `project: string | null` and `tags: string[]`; a text line is
  `<ref>  <priority>  <title>[  #project][ @tag…][  <date>]`.

- [ ] **Step 1: The failing tests** — append to `describe('quick-add markers', …)`:

```ts
    // Scenario 3.
    it('shows labels after the title and filters by all of them', async () => {
      const d = deps(fakeServer().send);
      await run(['add', 'call the bank @phone #finance'], d);
      await run(['add', 'water the plants @home'], d);
      await run(['add', 'ring the plumber @phone @home'], d);

      expect((await run(['list'], d)).stdout).toEqual([
        'id-6  0  call the bank  #finance @phone',
        'id-11  0  water the plants  @home',
        'id-14  0  ring the plumber  @home @phone',
      ]);
      expect((await run(['list', '@Phone', '@home'], d)).stdout).toEqual([
        'id-14  0  ring the plumber  @home @phone',
      ]);
      expect((await run(['list', '#finance'], d)).stdout).toEqual([
        'id-6  0  call the bank  #finance @phone',
      ]);
      expect(envelope((await run(['list', '#finance', '--json'], d)).stdout)).toMatchObject({
        data: [{ title: 'call the bank', project: 'finance', tags: ['@phone'] }],
      });
    });

    it('refuses a list argument that is not a marker', async () => {
      const d = deps(unreachable);
      await expect(run(['list', 'phone'], d)).rejects.toThrow(/list takes @tag and #project filters/);
    });
```

The refs follow `deps`'s counter and Task 3's order (project id, its op,
each new tag id and its op, task op, task id, one op per link): the first add
uses 1–7 (task `id-6`), the second 8–12 (task `id-11`), the third reuses both
tags, 13–16 (task `id-14`).

Run — FAIL (no labels in the line; `list phone` lists everything).

- [ ] **Step 2: Implement**

In `parse-quick-add.ts` export the two patterns: `export const TAG = …` and
`export const PROJECT = …` (same values).

In `run.ts` extend `Due`:

```ts
type Due = Row & {
  ref: string;
  occurrence: string | null;
  project: string | null;
  tags: string[];
};
```

Replace the `list` branch:

```ts
  } else if (command === 'list') {
    const filters = rest.map((arg) => {
      if (TAG.test(arg)) return { tag: nameKey(arg) };
      if (PROJECT.test(arg)) return { project: nameKey(arg.slice(1)) };
      throw new UsageError(
        `list takes @tag and #project filters, not ${JSON.stringify(arg)}`,
      );
    });
    ({ synced } = await flush(store, deps.send));
    const rows = due(store, localDate(deps.now())).filter((row) =>
      filters.every((f) =>
        'tag' in f
          ? row.tags.some((name) => nameKey(name) === f.tag)
          : row.project !== null && nameKey(row.project) === f.project,
      ),
    );
    data = rows;
    human = rows.map((row) =>
      [
        row.ref,
        String(row.priority),
        String(row.title),
        ...(row.project === null && row.tags.length === 0
          ? []
          : [
              [...(row.project === null ? [] : [`#${row.project}`]), ...row.tags].join(' '),
            ]),
        ...(row.occurrence === null ? [] : [row.occurrence]),
      ].join('  '),
    );
```

(import `nameKey` from `@todoer/specs`, `TAG`, `PROJECT` from
`./parse-quick-add.js`). In `due`, compute the label rows once and add them
to each row:

```ts
function due(store: Store, today: string): Due[] {
  const all = tasks(store);
  const marks = occurrences(store);
  const labelRows = { projects: projects(store), tags: tagRows(store), links: links(store) };
  return liveTasks(all).flatMap((task) => {
    const taskId = String(task.id);
    const current = currentOccurrence(
      recurrenceOf(task, parentOf(all, task)),
      stateOf(marks, taskId),
      today,
    );
    return current === null
      ? []
      : [
          {
            ...task,
            ref: shortRef(taskId),
            occurrence: current.occurrence,
            ...labelsOf(task, labelRows),
          },
        ];
  });
}
```

- [ ] **Step 3:** `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint` — PASS,
      including every earlier `list` assertion (tasks without labels print as
      before). Mutations (revert each): `filters.every` → `filters.some` —
      the two-tag filter test fails; compare `row.tags` without `nameKey` —
      `list @Phone` fails.
- [ ] **Step 4: Commit:** `git add apps/cli/src && git commit -m "feat(cli): show and filter list by project and tags" -m "Storing contexts is only useful if a caller can ask what to do @phone; filtering by name key also hides tolerated duplicates."`
      Tick T004.

---

### Task 5: Planning the merge

Implements FR-008's planning half (T005). Departure 1.

**Files:** Create `apps/cli/src/merge.ts`, `apps/cli/src/merge.spec.ts`.

**Interfaces:**

- Consumes: `isAttached`, `liveProjects`, `liveTags`, `winner` (Task 2);
  `nameKey`, `taskTagId`, type `Op` from `@todoer/specs`.
- Produces: `type View = { tasks: Row[]; projects: Row[]; tags: Row[]; links: Row[] }`;
  `planMerge(view: View, newId: () => string, ts: string): { ops: Op[]; merged: string[] }`.

- [ ] **Step 1: The failing test** — `apps/cli/src/merge.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { taskTagId } from '@todoer/specs';
import { planMerge } from './merge.js';

function ids() {
  let n = 0;
  return () => `n${String(++n)}`;
}

const view = {
  tasks: [
    { id: 't1', projectId: 'pb', deletedAt: null },
    { id: 't2', projectId: 'pa', deletedAt: null },
  ],
  projects: [
    { id: 'pb', name: 'Finance', version: 2, deletedAt: null, archivedAt: null },
    { id: 'pa', name: 'finance', version: 1, deletedAt: null, archivedAt: null },
    { id: 'pz', name: 'finance', version: 1, deletedAt: null, archivedAt: '2026-01-01T00:00:00Z' },
  ],
  tags: [
    { id: 'gb', name: '@phone', version: 3, deletedAt: null },
    { id: 'ga', name: '@Phone', version: 1, deletedAt: null },
    { id: 'gp', name: '@phone', deletedAt: null },
  ],
  links: [
    { id: 'l1', taskId: 't1', tagId: 'gb', deletedAt: null },
    { id: 'l2', taskId: 't2', tagId: 'gb', deletedAt: null, attached: false },
  ],
};

describe('planMerge', () => {
  it('moves attached links and tasks to the lowest id and deletes the losers', () => {
    expect(planMerge(view, ids(), 'T')).toEqual({
      ops: [
        { opId: 'n1', kind: 'create', table: 'task_tag', id: taskTagId('t1', 'ga'), fields: { taskId: 't1', tagId: 'ga', attached: true }, ts: 'T' },
        { opId: 'n2', kind: 'set', table: 'task_tag', id: 'l1', field: 'attached', value: false, ts: 'T' },
        { opId: 'n3', kind: 'delete', table: 'tag', id: 'gb', baseVersion: 3 },
        { opId: 'n4', kind: 'set', table: 'task', id: 't1', field: 'projectId', value: 'pa', ts: 'T' },
        { opId: 'n5', kind: 'delete', table: 'project', id: 'pb', baseVersion: 2 },
      ],
      merged: ['@Phone (2)', '#finance (2)'],
    });
  });

  // Review Focus 4, departure 1: a detached link stays detached, an archived
  // project and a row the server has not confirmed are left alone.
  it('leaves detached links, archived projects and unconfirmed rows out', () => {
    const { ops } = planMerge(view, ids(), 'T');
    expect(ops.some((op) => op.id === 'l2')).toBe(false);
    expect(ops.some((op) => op.id === 'pz')).toBe(false);
    expect(ops.some((op) => op.id === 'gp')).toBe(false);
  });

  it('plans nothing when no two live names collide', () => {
    expect(
      planMerge({ tasks: [], projects: [], tags: [{ id: 'a', name: '@a', version: 1, deletedAt: null }], links: [] }, ids(), 'T'),
    ).toEqual({ ops: [], merged: [] });
  });
});
```

Run — FAIL: `./merge.js` does not resolve.

- [ ] **Step 2: Implement** — `apps/cli/src/merge.ts`:

```ts
import { nameKey, taskTagId, type Op } from '@todoer/specs';
import { isAttached, liveProjects, liveTags, winner } from './labels.js';
import type { Row } from './store.js';

export type View = { tasks: Row[]; projects: Row[]; tags: Row[]; links: Row[] };

/**
 * Groups of two or more rows sharing a name key. Only rows the server has
 * confirmed take part — they carry a `version` — because a loser is deleted
 * with its `baseVersion`, and a row still in the outbox may yet arrive as
 * someone else's duplicate (plan departure 1).
 */
function duplicates(rows: Row[]): Row[][] {
  const byKey = new Map<string, Row[]>();
  for (const row of rows) {
    if (typeof row.name !== 'string' || typeof row.version !== 'number') {
      continue;
    }
    const key = nameKey(row.name);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return [...byKey.values()].filter((group) => group.length > 1);
}

/**
 * The operations that fold duplicate names into the lowest id (quick-add
 * design, Q7, Q10): a losing tag's attached links are re-made on the winner
 * and detached, a losing project's live tasks are moved, then the loser is
 * deleted. The winner keeps its own fields. Deterministic, so two clients
 * that see the same duplicates plan the same merge, and the derived TaskTag
 * ids make the repeated creates idempotent.
 */
export function planMerge(
  view: View,
  newId: () => string,
  ts: string,
): { ops: Op[]; merged: string[] } {
  const ops: Op[] = [];
  const merged: string[] = [];

  for (const group of duplicates(liveTags(view.tags))) {
    const keep = winner(group);
    if (keep === undefined) continue;
    const keepId = String(keep.id);
    for (const loser of group) {
      if (loser === keep) continue;
      for (const link of view.links) {
        if (link.tagId !== loser.id || !isAttached(link)) continue;
        const taskId = String(link.taskId);
        ops.push({
          opId: newId(),
          kind: 'create',
          table: 'task_tag',
          id: taskTagId(taskId, keepId),
          fields: { taskId, tagId: keepId, attached: true },
          ts,
        });
        ops.push({
          opId: newId(),
          kind: 'set',
          table: 'task_tag',
          id: String(link.id),
          field: 'attached',
          value: false,
          ts,
        });
      }
      ops.push({
        opId: newId(),
        kind: 'delete',
        table: 'tag',
        id: String(loser.id),
        baseVersion: Number(loser.version),
      });
    }
    merged.push(`${String(keep.name)} (${String(group.length)})`);
  }

  for (const group of duplicates(liveProjects(view.projects))) {
    const keep = winner(group);
    if (keep === undefined) continue;
    const keepId = String(keep.id);
    for (const loser of group) {
      if (loser === keep) continue;
      for (const task of view.tasks) {
        if (task.projectId !== loser.id || task.deletedAt !== null) continue;
        ops.push({
          opId: newId(),
          kind: 'set',
          table: 'task',
          id: String(task.id),
          field: 'projectId',
          value: keepId,
          ts,
        });
      }
      ops.push({
        opId: newId(),
        kind: 'delete',
        table: 'project',
        id: String(loser.id),
        baseVersion: Number(loser.version),
      });
    }
    merged.push(`#${String(keep.name)} (${String(group.length)})`);
  }
  return { ops, merged };
}
```

- [ ] **Step 3:** `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint` — PASS.
      Mutations (revert each): drop the `typeof row.version !== 'number'`
      guard — the unconfirmed-row assertion fails; drop `!isAttached(link)` —
      the detached-link assertion fails; use `liveTags` semantics for projects
      (ignore `archivedAt`) — the archived assertion fails.
- [ ] **Step 4: Commit:** `git add apps/cli/src/merge.ts apps/cli/src/merge.spec.ts && git commit -m "feat(cli): plan the merge of duplicate tag and project names" -m "Two offline devices can create the same name; folding duplicates into the lowest id is deterministic, so clients that merge at once converge."`
      Tick T005.

---

### Task 6: Queue the merge after every pull

Implements FR-008, FR-009 (T006).

**Files:** Modify `apps/cli/src/run.ts`, `apps/cli/src/run.spec.ts`.

**Interfaces:** Consumes `planMerge` (Task 5) and the overlay helpers.

- [ ] **Step 1: Teach the fake server versions, sets and deletes**

In `run.spec.ts` `fakeServer`: a create stores `version: 1` in the row; add,
before the final `duplicate` return:

```ts
      if (op.kind === 'set' && existing !== undefined) {
        const version = Number(existing.row.version ?? 1) + 1;
        rows.set(op.id, { ...existing, seq: ++seq, row: { ...existing.row, [op.field]: op.value, version } });
        return { opId: op.opId, status: 'applied' as const };
      }
      if (op.kind === 'delete' && existing !== undefined) {
        const version = Number(existing.row.version ?? 1) + 1;
        rows.set(op.id, { ...existing, seq: ++seq, row: { ...existing.row, deletedAt: '2026-09-26T10:00:00.000Z', version } });
        return { opId: op.opId, status: 'applied' as const };
      }
```

(and `version: 1` inside the new-row `row: { …, version: 1 }`; the
task_occurrence merge branch bumps `version` likewise). Expose a way for the
test to seed a server row: return `{ send, requests, rows }` from
`fakeServer` and let a test call `rows.set(id, change)` with a higher `seq`.

- [ ] **Step 2: The failing tests**

```ts
  describe('merging duplicate names', () => {
    // Scenario 4 and Review Focus 3.
    it('queues the merge after a pull, sends it with the next command, and stops', async () => {
      const server = fakeServer();
      const d = deps(server.send);
      await run(['add', 'call the bank @phone'], d);
      // Another device created the same name offline.
      server.rows.set('other-tag', {
        table: 'tag',
        id: 'other-tag',
        seq: 100,
        row: { id: 'other-tag', name: '@Phone', version: 1, deletedAt: null },
      });

      const first = await run(['list'], d);
      expect(first.stderr.join('\n')).toMatch(/merging duplicate @phone \(2\)/);
      expect(d.store.pending().map((op) => `${op.kind} ${op.table}`)).toEqual([
        'delete tag',
      ]);

      await run(['list'], d);
      const liveTags = [...server.rows.values()].filter(
        (c) => c.table === 'tag' && c.row.deletedAt === null,
      );
      expect(liveTags.map((c) => c.id)).toEqual(['id-1']);
      expect(d.store.pending()).toEqual([]);

      const third = await run(['list'], d);
      expect(third.stderr.join('\n')).not.toMatch(/merging/);
    });

    it('does not merge when the server was not reached', async () => {
      const d = deps(unreachable);
      d.store.mergeChanges([
        { table: 'tag', id: 'tag-a', seq: 1, row: { id: 'tag-a', name: '@phone', version: 1, deletedAt: null } },
        { table: 'tag', id: 'tag-b', seq: 2, row: { id: 'tag-b', name: '@Phone', version: 1, deletedAt: null } },
      ]);
      const out = await run(['list'], d);
      expect(out.stderr.join('\n')).not.toMatch(/merging/);
      expect(d.store.pending()).toEqual([]);
    });
  });
```

Here the local tag `id-1` (minted first) sorts below `other-tag`, so it wins
and only the other tag is deleted; the task's link already points at the
winner, so no link moves. If the ids in your run differ, keep the assertion
that exactly one `@phone` tag stays live and that the third `list` merges
nothing.

Run — FAIL (no merge note, nothing queued).

- [ ] **Step 3: Implement**

Import `planMerge` from `./merge.js`. In `run`, right after the command
`if/else` chain and before `const outbox = store.counts();`:

```ts
  // Every pull may bring a duplicate name another device created offline
  // (quick-add design, Q9). The merge is queued, not sent: the next command
  // delivers it, like any other queued operation.
  if (synced) {
    const { ops, merged } = planMerge(
      { tasks: tasks(store), projects: projects(store), tags: tagRows(store), links: links(store) },
      deps.newId,
      deps.now().toISOString(),
    );
    if (ops.length > 0) {
      store.transaction(() => {
        for (const op of ops) store.enqueue(op);
      });
      for (const name of merged) {
        stderr.push(`note: merging duplicate ${name} — sent with the next command`);
      }
    }
  }
```

The overlay hides a loser once its delete is pending, so the next command's
plan sees no duplicate and queues nothing twice.

- [ ] **Step 4:** `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint` — PASS.
      Mutations (revert each): drop `if (synced)` — "does not merge when the
      server was not reached" fails; enqueue only when `merged.length > 1` —
      the scenario test fails.
- [ ] **Step 5: Commit:** `git add apps/cli/src && git commit -m "feat(cli): merge duplicate tag and project names after each pull" -m "The merge is queued, not sent, so it costs no extra round trip; the overlay hides a pending loser, so it is planned once."`
      Tick T006.

---

### Task 7: HELP, README, ADR 0007, walking skeleton

Implements FR-010 (T007).

**Files:** `apps/cli/src/usage.ts`, `apps/cli/src/usage.spec.ts`, `README.md`,
`docs/adr/0007-tags-only-no-contexts.md`,
`docs/specs/2026-09-28-quick-add-tags-projects-design.md`,
`scripts/walking-skeleton.sh`.

- [ ] **Step 1: HELP** — in `usage.ts` change the `list` usage line to
      `todoer list [@tag|#project ...] [--json]   what is open now …; filters
      keep tasks carrying every named label`, and replace the quick-add
      markers block with:

```text
quick-add markers:
  p0..p4      priority
  #project    the live, non-archived project of that name (any case);
              created if there is none
  @tag        a tag stored with its @ (a context); matched by name in any
              case, created if there is none
  Created names are reported on stderr. Two devices that create the same
  name offline end up with two rows; every client merges them after its
  next sync (lowest id wins) and says so on stderr.
```

Append to `usage.spec.ts`:

```ts
  it('documents stored markers and list filters', () => {
    expect(HELP).toMatch(/todoer list \[@tag\|#project \.\.\.\]/);
    expect(HELP).not.toMatch(/parsed, not stored/);
  });
```

- [ ] **Step 2: README** — remove "`#project` and `@tag` from quick-add" from
      the "Not built yet" paragraph, and add one sentence to the CLI bullet:
      "Quick-add stores `#project` and `@tag`, and `list @tag #project`
      filters by them."
- [ ] **Step 3: ADR 0007** — append `## Amendment (2026-10-01, #362)`:
      quick-add stores `@name` as the tag name (a context); names compare by
      `nameKey` (NFC, lower case) from `@todoer/specs`; duplicate names from
      offline clients are tolerated and merged by every client after a pull,
      lowest id winning; link the design doc. The rename-is-a-`set` decision
      stands.
- [ ] **Step 4: Design doc** — add `## Departures in the plan` listing the
      four departures at the top of this plan, linking
      `../plans/2026-10-01-plan-quick-add-tags.md#where-this-plan-departs-from-the-design-doc`.
- [ ] **Step 5: Walking skeleton** — before the recurrence block in
      `scripts/walking-skeleton.sh`, add:

```sh
# Quick-add labels (#362): a tag created in one replica filters the second's
# list, through the server alone.
TAG="@skeleton$(date +%s)"
LTITLE="tagged $(date +%s)"
HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js add "$LTITLE $TAG" >/dev/null 2>&1
TAGGED=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js list "$TAG")
printf '%s' "$TAGGED" | grep -qF "$LTITLE" || {
  echo "FAIL: list $TAG in the second client did not find the tagged task" >&2
  printf '%s\n' "$TAGGED" >&2
  exit 1
}
```

Run it against a live backend as README "Running it" says (dev database
`todoer`, migrations deployed, `pnpm build`, backend on 3010), plus
`scripts/outbox-e2e.sh`; stop the backend afterwards.

- [ ] **Step 6: Gates and commit**

```bash
ugrep -rn -i -e 'not stored' -e 'parsed but' README.md apps/cli/src docs/adr/0007-tags-only-no-contexts.md
pnpm -w exec turbo run build typecheck test
pnpm lint
pnpm format
git add apps/cli/src/usage.ts apps/cli/src/usage.spec.ts README.md docs/adr/0007-tags-only-no-contexts.md docs/specs/2026-09-28-quick-add-tags-projects-design.md scripts/walking-skeleton.sh
git commit -m "docs: document stored quick-add markers and prove them end to end" \
  -m "HELP and the README still said projects and tags were parsed and dropped; ADR 0007 now records how names compare and how duplicates merge."
```

Tick T007. Closing the task follows the final review.
