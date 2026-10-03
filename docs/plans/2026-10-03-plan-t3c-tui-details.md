# Plan T3c: the TUI's details screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `e` on a task opens its details: title, project, tags, priority,
status, scheduled and due dates, recurrence, notes and subtasks; each field
edits and saves on its own.

**Architecture:** `details.tsx` exports `DetailsScreen`, which the shell's
`SCREENS` already reads. The app watches the task while the screen is open,
so the engine publishes its `task` topic (`taskDetails`). Each field is a row
with a reader (what it shows) and an editor (how it changes): a line input,
the status picker, a recurrence picker, or `$EDITOR` for notes. Pure parsing
lives in `fields.ts`.

**Tech Stack:** Ink 8 (`useApp().suspendTerminal` for `$EDITOR`), React
19.3, Vitest 5, `ink-testing-library`, `node:child_process`, `node:fs`.

**Spec:** `docs/specs/2026-10-03-tui-client-design.md` (Q7, Routine choices:
the details panel).

## Global Constraints

- Requires plan T2 (the shell) merged. Rebase on `origin/main` first.
- This plan owns `apps/tui/src/details.tsx` (replace the stub wholesale),
  `apps/tui/src/fields.ts`, `apps/tui/src/editor.ts` and their specs. Edit
  no other source file; the outline, board and statuses plans run in
  parallel.
- One field, one write: `edit` with that field alone, `setRule` for
  recurrence, `move` with `statusId` for status.
- Dates are `YYYY-MM-DD`; empty clears; anything else is said on the status
  line and not written (ADR 0010: dates without times).
- Recurrence is refused for a subtask before any write (the core refuses it
  too: "a subtask repeats with its parent").
- The full-screen form below 120 columns; at the right of the pane from 120.
  v1 renders it in the pane either way (the app gives the screen the pane);
  a side-by-side layout is not in this plan.
- Work on branch `feat/tui-details` in this plan's own worktree.

---

### Task 1: Field parsing and recurrence presets

**Files:**

- Create: `apps/tui/src/fields.ts`, `apps/tui/src/fields.spec.ts`
- Create: `specs/tasks/active/T-2026-10-03-tui-details.md`

**Interfaces:**

- Consumes: `parseRrule`, `TaskChanges`, `Rule` from `@todoer/client-core`.
- Produces:
  - `parseDate(text: string): string | null | 'invalid'` (`null`: cleared)
  - `parseTags(text: string): string[]` (`@a @b` or `a b` → `['@a', '@b']`)
  - `parsePriority(text: string): number | 'invalid'`
  - `type Preset = { id: string; label: string; rule: (dtstart: string) => Rule | null }`
  - `presets(dtstart: string): Preset[]` (none, daily, weekdays, weekly on
    dtstart's weekday, monthly on dtstart's day)
  - `customRule(rrule: string, dtstart: string): Rule | string` (a string is
    the problem)
  - `describeRule(rrule: string | null): string`

- [ ] **Step 1: Task spec**

Create `specs/tasks/active/T-2026-10-03-tui-details.md` from the template:

- **FR-001** `e` opens the task's details; Esc closes them
- **FR-002** title, project, tags and priority edit as lines and save alone
- **FR-003** scheduled and due take `YYYY-MM-DD`; empty clears; anything
  else is refused on the status line
- **FR-004** status edits through the status picker
- **FR-005** recurrence edits through presets or a raw RRULE checked by
  `parseRrule`; refused for a subtask
- **FR-006** notes edit in `$EDITOR` (`vi` when unset)
- **FR-007** the subtasks are listed with their state
- Steps T001–T004 mirroring this plan's Tasks 1–4.

- [ ] **Step 2: Failing tests**

`apps/tui/src/fields.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  customRule,
  describeRule,
  parseDate,
  parsePriority,
  parseTags,
  presets,
} from './fields.js';

describe('parseDate', () => {
  it('takes YYYY-MM-DD, clears on empty, refuses the rest', () => {
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('  ')).toBeNull();
    expect(parseDate('2026-13-01')).toBe('invalid');
    expect(parseDate('tomorrow')).toBe('invalid');
  });
});

describe('parseTags', () => {
  it('adds the @ the store keeps, drops duplicates', () => {
    expect(parseTags('@a b  @a')).toEqual(['@a', '@b']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('parsePriority', () => {
  it('takes 0-4 with or without p', () => {
    expect(parsePriority('p2')).toBe(2);
    expect(parsePriority('3')).toBe(3);
    expect(parsePriority('')).toBe(0);
    expect(parsePriority('p7')).toBe('invalid');
  });
});

describe('presets', () => {
  // 2026-10-05 is a Monday.
  const all = presets('2026-10-05');
  const rule = (id: string) => all.find((p) => p.id === id)?.rule('2026-10-05');
  it('builds each rule from dtstart', () => {
    expect(rule('none')).toBeNull();
    expect(rule('daily')).toEqual({ rrule: 'FREQ=DAILY', dtstart: '2026-10-05' });
    expect(rule('weekdays')?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(rule('weekly')?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(rule('monthly')?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=5');
  });
  it('labels name the day', () => {
    expect(all.find((p) => p.id === 'weekly')?.label).toMatch(/Mon/);
  });
});

describe('customRule', () => {
  it('accepts what parseRrule accepts, explains what it does not', () => {
    expect(customRule('FREQ=WEEKLY;INTERVAL=2', '2026-10-05')).toEqual({
      rrule: 'FREQ=WEEKLY;INTERVAL=2',
      dtstart: '2026-10-05',
    });
    expect(typeof customRule('FREQ=SOMETIMES', '2026-10-05')).toBe('string');
  });
});

describe('describeRule', () => {
  it('reads common rules back', () => {
    expect(describeRule(null)).toBe('—');
    expect(describeRule('FREQ=DAILY')).toBe('daily');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO')).toBe('weekly · MO');
    expect(describeRule('FREQ=YEARLY')).toBe('FREQ=YEARLY');
  });
});
```

Run: `pnpm --filter @todoer/tui exec vitest run src/fields.spec.ts`
Expected: FAIL, missing module.

- [ ] **Step 3: Implement**

`apps/tui/src/fields.ts`:

```ts
import { parseRrule, type Rule } from '@todoer/client-core';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real date; empty clears (null). */
export function parseDate(text: string): string | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  if (!ISO.test(t)) return 'invalid';
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t
    ? 'invalid'
    : t;
}

/** Tags as the store keeps them, with their `@` (labels.ts). */
export function parseTags(text: string): string[] {
  const names = text
    .split(/\s+/)
    .filter((t) => t !== '')
    .map((t) => (t.startsWith('@') ? t : `@${t}`));
  return [...new Set(names)];
}

export function parsePriority(text: string): number | 'invalid' {
  const t = text.trim().replace(/^p/, '');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 'invalid';
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type Preset = {
  id: string;
  label: string;
  rule: (dtstart: string) => Rule | null;
};

/** The recurrence choices, weekday and day of month taken from `dtstart`. */
export function presets(dtstart: string): Preset[] {
  const d = new Date(`${dtstart}T00:00:00Z`);
  const day = d.getUTCDay();
  const date = d.getUTCDate();
  const r = (rrule: string) => (start: string) => ({ rrule, dtstart: start });
  return [
    { id: 'none', label: 'does not repeat', rule: () => null },
    { id: 'daily', label: 'daily', rule: r('FREQ=DAILY') },
    {
      id: 'weekdays',
      label: 'every weekday',
      rule: r('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'),
    },
    {
      id: 'weekly',
      label: `weekly on ${NAMES[day] ?? ''}`,
      rule: r(`FREQ=WEEKLY;BYDAY=${DAYS[day] ?? 'MO'}`),
    },
    {
      id: 'monthly',
      label: `monthly on day ${date}`,
      rule: r(`FREQ=MONTHLY;BYMONTHDAY=${date}`),
    },
  ];
}

/** A raw RRULE the core can expand, or why not. */
export function customRule(rrule: string, dtstart: string): Rule | string {
  const parsed = parseRrule(rrule.trim());
  return parsed.ok ? { rrule: rrule.trim(), dtstart } : parsed.error;
}

export function describeRule(rrule: string | null): string {
  if (rrule === null) return '—';
  if (rrule === 'FREQ=DAILY') return 'daily';
  const weekly = /^FREQ=WEEKLY;BYDAY=([A-Z,]+)$/.exec(rrule);
  if (weekly !== null) return `weekly · ${weekly[1]}`;
  const monthly = /^FREQ=MONTHLY;BYMONTHDAY=(\d+)$/.exec(rrule);
  if (monthly !== null) return `monthly · day ${monthly[1]}`;
  return rrule;
}
```

If `parseRrule`'s result has another shape than `{ ok, error }`, read it in
`packages/specs/src` (re-exported by the core) and adapt `customRule`; the
test stays.

Run: `pnpm --filter @todoer/tui exec vitest run src/fields.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/fields.ts apps/tui/src/fields.spec.ts specs/tasks/active
git commit -m "feat(tui): parse task fields and recurrence presets"
```

---

### Task 2: `$EDITOR` for notes

**Files:**

- Create: `apps/tui/src/editor.ts`, `apps/tui/src/editor.spec.ts`

**Interfaces:**

- Produces: `editText(text: string, env: NodeJS.ProcessEnv, run?: (cmd: string, file: string) => number): string | null`
  (`null`: the editor failed or the text did not change)

- [ ] **Step 1: Failing test**

`apps/tui/src/editor.spec.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editText } from './editor.js';

describe('editText', () => {
  it('returns what the editor left in the file', () => {
    const out = editText('old', { EDITOR: 'fake' }, (cmd, file) => {
      expect(cmd).toBe('fake');
      expect(readFileSync(file, 'utf8')).toBe('old');
      writeFileSync(file, 'new\n');
      return 0;
    });
    expect(out).toBe('new');
  });

  it('is null when nothing changed or the editor failed', () => {
    expect(editText('same', {}, () => 0)).toBeNull();
    expect(editText('x', {}, () => 1)).toBeNull();
  });

  it('falls back to vi', () => {
    let used = '';
    editText('x', {}, (cmd) => ((used = cmd), 0));
    expect(used).toBe('vi');
  });
});
```

Run: `pnpm --filter @todoer/tui exec vitest run src/editor.spec.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`apps/tui/src/editor.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Runs `$EDITOR file` attached to the terminal; its exit status. The
 *  command may carry arguments (`code --wait`), so it goes through a shell. */
const runEditor = (cmd: string, file: string): number =>
  spawnSync('sh', ['-c', `${cmd} "$1"`, 'sh', file], { stdio: 'inherit' })
    .status ?? 1;

/**
 * Edits `text` in `$EDITOR` (`$VISUAL` first, `vi` last) through a private
 * temp file. Null when the editor failed or left the text as it was. The
 * trailing newline editors add is dropped. Call it with Ink suspended.
 */
export function editText(
  text: string,
  env: NodeJS.ProcessEnv,
  run: (cmd: string, file: string) => number = runEditor,
): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'todoer-notes-'));
  const file = join(dir, 'notes.md');
  try {
    writeFileSync(file, text, { mode: 0o600 });
    const cmd = env.VISUAL || env.EDITOR || 'vi';
    if (run(cmd, file) !== 0) return null;
    const next = readFileSync(file, 'utf8').replace(/\n$/, '');
    return next === text ? null : next;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

(The file goes in as `$1`, never spliced into the command string, so a path
with spaces is safe; the command itself is the user's own `$EDITOR`, so
`EDITOR="code --wait"` works.)

Run: `pnpm --filter @todoer/tui exec vitest run src/editor.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/tui/src/editor.ts apps/tui/src/editor.spec.ts
git commit -m "feat(tui): edit notes in the user's editor"
```

---

### Task 3: The details screen

**Files:**

- Replace: `apps/tui/src/details.tsx`
- Create: `apps/tui/src/details.spec.tsx`

**Interfaces:**

- Consumes: `useTui`, `useTask`, `useTopic` (`topics.ts`), `useWrite`,
  `LineInput`, `Picker`, `StatusPicker`, `renderTui`, `fakeServer`, `KEY`,
  Tasks 1–2.
- Produces: `DetailsScreen: (p: { taskId: string; close(): void }) => ReactNode`.

The app already watches `{ task: taskId }` while `screen.kind ===
'details'` (shell plan, `app.tsx`), so `useTask(topics, taskId)` has it.

- [ ] **Step 1: Failing render tests**

`apps/tui/src/details.spec.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './app.js';
import { fakeServer, KEY, renderTui } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

const status = {
  table: 'status',
  id: 's1',
  name: 'To do',
  rank: 'a0',
  completing: false,
  version: 1,
};
const task = {
  table: 'task',
  id: 't1',
  title: 'milk',
  rank: 'a0',
  priority: 0,
  version: 1,
};

async function details() {
  const t = await renderTui(<App />, { server: fakeServer([status, task]) });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.press('e');
  return t;
}
const row = (t: Awaited<ReturnType<typeof details>>) =>
  t.store.rows('task').find((r) => r.id === 't1');

describe('DetailsScreen', () => {
  it('shows the fields and closes with Esc', async () => {
    const t = await details();
    for (const label of ['Title', 'Project', 'Tags', 'Due', 'Repeat', 'Notes']) {
      expect(t.lastFrame()).toContain(label);
    }
    await t.press(KEY.escape);
    expect(t.lastFrame()).not.toContain('Repeat');
  });

  it('sets a due date, and refuses one that is not a date', async () => {
    const t = await details();
    // Title, Project, Tags, Priority, Status, Scheduled, Due
    await t.press('j', 'j', 'j', 'j', 'j', 'j', KEY.enter, '2026-10-09', KEY.enter);
    expect(row(t)?.dueOn).toBe('2026-10-09');
    await t.press(KEY.enter, 'soon', KEY.enter);
    expect(t.lastFrame()).toMatch(/YYYY-MM-DD/);
    expect(row(t)?.dueOn).toBe('2026-10-09');
  });

  it('makes the task repeat daily', async () => {
    const t = await details();
    await t.press('j', 'j', 'j', 'j', 'j', 'j', 'j', KEY.enter, 'j', KEY.enter);
    expect(row(t)?.rrule).toBe('FREQ=DAILY');
  });
});
```

(The field order is the one in Step 2; if it changes, change the `j`
counts with it.)

Run: `pnpm --filter @todoer/tui exec vitest run src/details.spec.tsx`
Expected: FAIL (the stub has no screen; `e` says "not built yet").

- [ ] **Step 2: Implement**

`apps/tui/src/details.tsx`:

```tsx
import { Box, Text, useApp, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import type { TaskChanges } from '@todoer/client-core';
import { useTui } from './context.js';
import { editText } from './editor.js';
import {
  customRule,
  describeRule,
  parseDate,
  parsePriority,
  parseTags,
  presets,
} from './fields.js';
import { useTask, useTopic } from './topics.js';
import { LineInput } from './ui/line-input.js';
import { Picker } from './ui/picker.js';
import { StatusPicker } from './ui/status-picker.js';
import { useWrite } from './use-write.js';

type FieldId =
  | 'title'
  | 'project'
  | 'tags'
  | 'priority'
  | 'status'
  | 'scheduledOn'
  | 'dueOn'
  | 'repeat'
  | 'notes';
const FIELDS: { id: FieldId; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'project', label: 'Project' },
  { id: 'tags', label: 'Tags' },
  { id: 'priority', label: 'Priority' },
  { id: 'status', label: 'Status' },
  { id: 'scheduledOn', label: 'Scheduled' },
  { id: 'dueOn', label: 'Due' },
  { id: 'repeat', label: 'Repeat' },
  { id: 'notes', label: 'Notes' },
];

type Editing = null | FieldId | 'custom-rule';

function Details({ taskId, close }: { taskId: string; close: () => void }) {
  const { topics, status, today } = useTui();
  const write = useWrite();
  const { suspendTerminal } = useApp();
  const published = useTask(topics, taskId);
  const statuses = useTopic(topics, 'catalog')?.statuses ?? [];
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const task = published?.task ?? null;

  const edit = (changes: TaskChanges) =>
    void write((newId) => ({ kind: 'edit', opId: newId(), taskId, changes }));
  const dtstart =
    task?.dtstart ??
    (typeof task?.scheduledOn === 'string' ? task.scheduledOn : today());
  const isSubtask = typeof task?.parentId === 'string';

  const openField = async (id: FieldId) => {
    if (task === null) return;
    if (id === 'repeat' && isSubtask) {
      status.say({ tone: 'info', text: 'a subtask repeats with its parent' });
      return;
    }
    if (id !== 'notes') return setEditing(id);
    let next: string | null = null;
    await suspendTerminal(async () => {
      next = editText(task.notes ?? '', process.env);
    });
    if (next !== null) edit({ notes: next });
  };

  useInput(
    (input, key) => {
      status.clear();
      if (key.escape || input === 'q') return close();
      if (input === 'j' || key.downArrow) setAt((i) => Math.min(FIELDS.length - 1, i + 1));
      else if (input === 'k' || key.upArrow) setAt((i) => Math.max(0, i - 1));
      else if (key.return) {
        const field = FIELDS[at];
        if (field !== undefined) void openField(field.id);
      }
    },
    { isActive: editing === null },
  );

  if (published === undefined) return <Text dimColor>loading…</Text>;
  if (task === null) {
    return <Text color="yellow">this task is gone · Esc to go back</Text>;
  }

  const shown: Record<FieldId, string> = {
    title: String(task.title),
    project: task.project ?? '—',
    tags: task.tags.join(' ') || '—',
    priority: Number(task.priority ?? 0) > 0 ? `p${String(task.priority)}` : '—',
    status: statuses.find((s) => s.id === task.column)?.name ?? '—',
    scheduledOn: typeof task.scheduledOn === 'string' ? task.scheduledOn : '—',
    dueOn: typeof task.dueOn === 'string' ? task.dueOn : '—',
    repeat: isSubtask ? 'with its parent' : describeRule(task.rrule),
    notes:
      task.notes === null
        ? '— · Enter opens $EDITOR'
        : `${task.notes.split('\n').length} lines · Enter opens $EDITOR`,
  };

  const line = (label: string, initial: string, save: (text: string) => void) => (
    <LineInput
      label={`${label}:`}
      initial={initial}
      onCancel={() => setEditing(null)}
      onSubmit={(text) => {
        setEditing(null);
        save(text);
      }}
    />
  );
  const date = (id: 'scheduledOn' | 'dueOn') =>
    line(id === 'dueOn' ? 'Due' : 'Scheduled', shown[id] === '—' ? '' : shown[id], (text) => {
      const value = parseDate(text);
      if (value === 'invalid') {
        status.say({ tone: 'error', text: 'a date is YYYY-MM-DD; empty clears it' });
      } else {
        edit({ [id]: value });
      }
    });

  const editor: ReactNode =
    editing === 'title'
      ? line('Title', String(task.title), (title) => edit({ title }))
      : editing === 'project'
        ? line('Project', task.project ?? '', (p) =>
            edit({ project: p.trim() === '' ? null : p.trim().replace(/^#/, '') }),
          )
        : editing === 'tags'
          ? line('Tags', task.tags.join(' '), (t) => edit({ tags: parseTags(t) }))
          : editing === 'priority'
            ? line('Priority', shown.priority === '—' ? '' : shown.priority, (p) => {
                const n = parsePriority(p);
                if (n === 'invalid') {
                  status.say({ tone: 'error', text: 'priority is p0 to p4' });
                } else {
                  edit({ priority: n });
                }
              })
            : editing === 'status'
              ? (
                  <StatusPicker
                    taskId={taskId}
                    current={task.column}
                    view="all"
                    onDone={() => setEditing(null)}
                  />
                )
              : editing === 'scheduledOn' || editing === 'dueOn'
                ? date(editing)
                : editing === 'repeat'
                  ? (
                      <Picker
                        title="Repeat"
                        items={[
                          ...presets(dtstart).map((p) => ({ id: p.id, label: p.label })),
                          { id: 'custom', label: 'custom RRULE…' },
                        ]}
                        onCancel={() => setEditing(null)}
                        onPick={(id) => {
                          if (id === 'custom') return setEditing('custom-rule');
                          setEditing(null);
                          const preset = presets(dtstart).find((p) => p.id === id);
                          if (preset === undefined) return;
                          const rule = preset.rule(dtstart);
                          void write((newId) => ({ kind: 'setRule', opId: newId(), taskId, rule }));
                        }}
                      />
                    )
                  : editing === 'custom-rule'
                    ? line('RRULE', task.rrule ?? '', (text) => {
                        const rule = customRule(text, dtstart);
                        if (typeof rule === 'string') {
                          status.say({ tone: 'error', text: rule });
                        } else {
                          void write((newId) => ({ kind: 'setRule', opId: newId(), taskId, rule }));
                        }
                      })
                    : null;

  return (
    <Box flexDirection="column">
      <Text bold>{String(task.title)}</Text>
      {FIELDS.map((f, i) => (
        <Box key={f.id}>
          <Box width={11}>
            <Text dimColor>{f.label}</Text>
          </Box>
          <Text inverse={editing === null && i === at}>{shown[f.id]}</Text>
        </Box>
      ))}
      {task.subtasks.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Subtasks</Text>
          {task.subtasks.map((s) => (
            <Text key={s.id}>
              {s.closed ? '✓ ' : '· '}
              {s.title}
            </Text>
          ))}
        </Box>
      )}
      {editor}
      <Text dimColor>j/k field · Enter edit · Esc back</Text>
    </Box>
  );
}

export const DetailsScreen = (p: { taskId: string; close: () => void }) => (
  <Details {...p} />
);
```

`edit({ [id]: value })` builds `{ dueOn: … }` or `{ scheduledOn: … }`;
with `exactOptionalPropertyTypes` TypeScript may need
`edit(id === 'dueOn' ? { dueOn: value } : { scheduledOn: value })`. Use that
form if the computed key does not typecheck.

The nested ternary for `editor` is long; if lint or review objects, turn it
into a `switch` in a small `renderEditor(editing)` function in the same
file. Behaviour stays.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @todoer/tui exec vitest run`
Expected: PASS. `suspendTerminal` is not exercised by the render tests;
`editor.spec.ts` covers `editText`, and Task 4 checks it by hand.

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/details.tsx apps/tui/src/details.spec.tsx
git commit -m "feat(tui): edit every task field from a details screen"
```

---

### Task 4: By hand, documents, PR

- [ ] **Step 1: By hand**

Build and run; open details on a task; set and clear each date; repeat
weekly, then custom `FREQ=WEEKLY;INTERVAL=2`, then none; edit notes with
`EDITOR=nano` and with `EDITOR="code --wait"`; check `todoer show <ref>`
in another shell. Note anything surprising in the task spec.

- [ ] **Step 2: Design doc**

In `docs/specs/2026-10-03-tui-client-design.md`, Routine choices, **The
details panel**: replace "At the right from 120 columns, full screen below."
with "It takes the main pane; a side-by-side layout from 120 columns is
deferred."

- [ ] **Step 3: Gates**

Run: `pnpm -w exec turbo run build typecheck test --filter=@todoer/tui... && pnpm lint`
Expected: green.

- [ ] **Step 4: Close the task spec, changelog, PR**

Tick, `Status: done`, `Completed`, `Result`; `git add`; `git mv` to
`specs/tasks/done/`.

`dnote add todoer -c "2026-10-03 · The TUI edits every task field from a details screen: dates, status, recurrence presets or a raw RRULE, notes in \$EDITOR."`

```bash
git add -A
git commit -m "docs: close the TUI details task"
git push -u origin feat/tui-details
gh pr create --title "feat(tui): edit every task field from a details screen" --body "…"
```
