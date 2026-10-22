import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURSOR_MARKER,
  stripTerminalSequences,
  visibleWidth,
} from '@earendil-works/pi-tui';
import { fakeServer, KEY, NOT_APPLIED, renderApp } from './test-kit.js';
import { Root } from './root.js';

let cleanup = () => {};
afterEach(() => cleanup());

const plain = (s: string) => stripTerminalSequences(s);

const status = (id: string, name: string, rank: string) => ({
  table: 'status',
  id,
  name,
  rank,
  completing: false,
  version: 1,
});
const project = (id: string, name: string) => ({
  table: 'project',
  id,
  name,
  rank: 'a0',
  version: 1,
});
const ids: Record<string, string> = {};
const id = (title: string) =>
  (ids[title] ??= `00000000-0000-7000-9000-${Object.keys(ids)
    .length.toString(16)
    .padStart(12, '0')}`);
const task = (title: string, extra: object = {}) => ({
  table: 'task',
  id: id(title),
  title,
  rank: 'a0',
  priority: 4,
  version: 1,
  ...extra,
});

/** The rows in FIELDS' order: j presses from Title to each. */
const AT = {
  title: 0,
  project: 1,
  priority: 3,
  status: 4,
  due: 6,
  repeat: 7,
  notes: 8,
  subtask: 9,
};
const down = (n: number) => Array<string>(n).fill('j');
const erase = (n: number) => Array<string>(n).fill('\u007f');

/** At 80 columns `e` shows the details full screen and Esc closes them;
 *  at 140 `e` focuses the detail column. */
async function details(
  rows: Record<string, unknown>[] = [task('milk')],
  {
    quit = () => undefined,
    width = 80,
    server = undefined,
  }: {
    quit?: () => void;
    width?: number;
    server?: ReturnType<typeof fakeServer>;
  } = {},
) {
  const t = await renderApp({
    width,
    rows: 24,
    server:
      server ??
      fakeServer([
        status('s1', 'To do', 'a0'),
        status('s2', 'Doing', 'a1'),
        project('p-home', 'home'),
        project('p-work', 'work'),
        ...rows,
      ]),
    app: (tui, size) => new Root({ tui, ...size, quit }),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.settle();
  await t.press('e');
  const lastFrame = () => t.lines().map(plain).join('\n');
  expect(lastFrame()).toContain('Repeat');
  /** The screen row whose text starts with `label`. */
  const rowOf = (label: string) =>
    t.lines().findIndex((l) => new RegExp(`^${label}\\b`).test(plain(l)));
  return { ...t, lastFrame, rowOf };
}
type Details = Awaited<ReturnType<typeof details>>;
const row = (t: Details, title = 'milk') =>
  t.store.rows('task').find((r) => r.id === id(title));
const mode = (t: Details) => plain(t.lines().at(-2) ?? '');
/** The cursor's screen column on `line`. */
const cursorAt = (line: string) =>
  visibleWidth(plain(line.slice(0, line.indexOf(CURSOR_MARKER))));

describe('DetailPane', () => {
  it('shows p0 for the highest priority and no label for P4', async () => {
    const hot = await details([task('milk', { priority: 0 })]);
    expect(hot.lastFrame()).toContain('p0');
    hot.cleanup();
    const plain = await details();
    expect(plain.lastFrame()).not.toMatch(/\bp\d\b/);
  });

  it('shows the fields in order and closes with Esc', async () => {
    const t = await details();
    const labels = [
      'Title',
      'Project',
      'Tags',
      'Priority',
      'Status',
      'Scheduled',
      'Due',
      'Repeat',
      'Notes',
    ];
    const at = labels.map((l) => t.rowOf(l));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at.every((i) => i >= 0)).toBe(true);
    await t.press(KEY.escape);
    expect(t.lastFrame()).not.toContain('Repeat');
    expect(t.lastFrame()).toContain('milk');
  });

  it('Enter on project opens an input on the project row with its value', async () => {
    const t = await details([task('milk', { projectId: 'p-home' })]);
    await t.press(...down(AT.project));
    const before = t.lines().map(plain);
    const at = t.rowOf('Project');
    await t.press(KEY.enter);
    const after = t.lines();
    expect(after.slice(0, at).map(plain)).toEqual(before.slice(0, at));
    expect(t.rowOf('Project')).toBe(at);
    expect(plain(after[at] ?? '')).toMatch(/^Project\s+home\s*$/);
    // The input's cursor sits on that row, after the value.
    expect(after[at]).toContain(CURSOR_MARKER);
    expect(cursorAt(after[at] ?? '')).toBe(
      plain(after[at] ?? '').indexOf('home') + 4,
    );
    expect(mode(t)).toMatch(/^INSERT/);
  });

  it('Enter saves one edit with the changed field only', async () => {
    const t = await details([task('milk', { projectId: 'p-home' })]);
    const sent = t.server.sent.length;
    await t.press(...down(AT.project), KEY.enter, ...erase(4), 'work');
    await t.press(KEY.enter);
    expect(row(t)?.projectId).toBe('p-work');
    const ops = t.server.sent.slice(sent);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'set', field: 'projectId' });
    expect(mode(t)).toMatch(/^NORMAL/);
    expect(t.lastFrame()).toMatch(/Project\s+work/);
  });

  it('Enter on an unchanged field sends nothing', async () => {
    const t = await details([task('milk', { projectId: 'p-home' })]);
    const sent = t.server.sent.length;
    await t.press(...down(AT.project), KEY.enter, KEY.enter);
    expect(t.server.sent.length).toBe(sent);
    expect(mode(t)).toMatch(/^NORMAL/);
  });

  it('Esc cancels and sends nothing', async () => {
    const t = await details([task('milk', { projectId: 'p-home' })]);
    const sent = t.server.sent.length;
    await t.press(...down(AT.project), KEY.enter, 'x', KEY.escape);
    expect(t.server.sent.length).toBe(sent);
    expect(t.lastFrame()).toMatch(/Project\s+home\s*$/m);
    expect(mode(t)).toMatch(/^NORMAL/);
    // Still in the details: Esc closed only the input.
    expect(t.lastFrame()).toContain('Repeat');
  });

  it('q inside an open input is a character', async () => {
    const quit = vi.fn();
    const t = await details([task('milk')], { quit });
    await t.press(KEY.enter, 'q', KEY.enter);
    expect(row(t)?.title).toBe('milkq');
    expect(quit).not.toHaveBeenCalled();
  });

  it('saves the tags and the title in place', async () => {
    const t = await details();
    await t.press(KEY.enter, ' and eggs', KEY.enter);
    expect(row(t)?.title).toBe('milk and eggs');
    await t.press(...down(2), KEY.enter, 'shop @x', KEY.enter);
    expect(t.lastFrame()).toContain('@shop @x');
  });

  it('keeps an invalid value open with its text', async () => {
    const t = await details();
    await t.press(...down(AT.priority), KEY.enter, 'p9', KEY.enter);
    expect(t.lastFrame()).toContain('priority is p0 to p4');
    expect(t.lastFrame()).toMatch(/Priority\s+p9/);
    expect(mode(t)).toMatch(/^INSERT/);
    await t.press(KEY.escape);
    expect(mode(t)).toMatch(/^NORMAL/);
  });

  it('sets a due date, and refuses one that is not a date', async () => {
    const t = await details();
    await t.press(...down(AT.due), KEY.enter, '2026-10-09', KEY.enter);
    expect(row(t)?.dueOn).toBe('2026-10-09');
    await t.press(KEY.enter, 'soon', KEY.enter);
    expect(t.lastFrame()).toMatch(/YYYY-MM-DD/);
    expect(t.lastFrame()).toContain('2026-10-09soon');
    expect(row(t)?.dueOn).toBe('2026-10-09');
  });

  it('clears a date with an empty line', async () => {
    const t = await details([task('milk', { dueOn: '2026-10-09' })]);
    await t.press(...down(AT.due), KEY.enter, ...erase(10), KEY.enter);
    expect(row(t)?.dueOn).toBeNull();
  });

  it('moves the task through the status picker on its row', async () => {
    const t = await details();
    const at = t.rowOf('Status');
    await t.press(...down(AT.status), KEY.enter);
    expect(plain(t.lines()[at] ?? '')).toMatch(/^Status\s+› To do/);
    await t.press('j', KEY.enter);
    expect(row(t)?.statusId).toBe('s2');
  });

  it('makes the task repeat daily, and from a raw RRULE', async () => {
    const t = await details();
    await t.press(...down(AT.repeat), KEY.enter, 'j', KEY.enter);
    expect(row(t)?.rrule).toBe('FREQ=DAILY');
    // The picker's last row is the custom rule.
    await t.press(KEY.enter, ...down(5), KEY.enter);
    await t.press(...erase(10), 'FREQ=NEVER', KEY.enter);
    expect(t.lastFrame()).toMatch(/Repeat\s+FREQ=NEVER/);
    expect(row(t)?.rrule).toBe('FREQ=DAILY');
  });

  it('notes: Alt+Enter inserts a newline and Enter saves both lines', async () => {
    const t = await details();
    const at = t.rowOf('Notes');
    await t.press(...down(AT.notes), KEY.enter, 'buy', '\u001b\r', 'whole');
    expect(mode(t)).toMatch(/^INSERT/);
    // The editor sits on the notes row and below it.
    expect(t.lastFrame()).toMatch(/^Notes\s+─+/m);
    expect(t.rowOf('Notes')).toBe(at);
    expect(t.lastFrame()).toMatch(/^\s+buy\s*$/m);
    await t.press(KEY.enter);
    expect(row(t)?.notes).toBe('buy\nwhole');
    expect(t.lastFrame()).toMatch(/Notes\s+2 lines/);
  });

  it('notes: Esc in the editor cancels', async () => {
    const t = await details();
    const sent = t.server.sent.length;
    await t.press(...down(AT.notes), KEY.enter, 'x', KEY.escape);
    expect(t.server.sent.length).toBe(sent);
    expect(mode(t)).toMatch(/^NORMAL/);
  });

  it('resize to 80 columns while editing keeps the typed text and the field', async () => {
    const t = await details([task('milk', { projectId: 'p-home' })], {
      width: 140,
    });
    await t.press(...down(AT.project), KEY.enter, ...erase(4), 'wor');
    t.resize(80, 24);
    // The full-screen details, the outline gone.
    expect(t.lastFrame()).not.toContain('VIEWS');
    expect(t.lastFrame()).toMatch(/^Project\s+wor\s*$/m);
    expect(mode(t)).toMatch(/^INSERT/);
    await t.press('k', KEY.enter);
    expect(row(t)?.projectId).toBe('p-work');
  });

  it('a publish while editing keeps the text and the cursor', async () => {
    const t = await details([task('milk', { projectId: 'p-home' })]);
    await t.press(...down(AT.project), KEY.enter, KEY.left);
    const at = t.rowOf('Project');
    const col = cursorAt(t.lines()[at] ?? '');
    await t.engine.handle(
      {
        kind: 'add',
        opId: '00000000-0000-7000-a000-000000000001',
        id: '00000000-0000-7000-a000-000000000002',
        text: 'bread',
      },
      'tui',
    );
    await t.settle();
    expect(t.store.rows('task').some((r) => r.title === 'bread')).toBe(true);
    expect(plain(t.lines()[at] ?? '')).toMatch(/^Project\s+home\s*$/);
    expect(cursorAt(t.lines()[at] ?? '')).toBe(col);
    await t.press('X', KEY.enter);
    expect(t.store.rows('project').some((r) => r.name === 'homXe')).toBe(true);
  });

  it('lists the subtasks with boxes and the progress, and ticks one with x', async () => {
    const t = await details([
      task('milk'),
      task('skim', { parentId: id('milk') }),
      task('whole', { parentId: id('milk'), rank: 'a1' }),
    ]);
    expect(t.lastFrame()).toMatch(/Subtasks\s+0\/2/);
    expect(t.lastFrame()).toContain('[ ] skim');
    await t.press(...down(AT.subtask), 'x');
    expect(t.lastFrame()).toContain('[x] skim');
    expect(t.lastFrame()).toMatch(/Subtasks\s+1\/2/);
    await t.press('j', ' ');
    expect(t.lastFrame()).toContain('[x] whole');
  });

  it("ticks a repeating task's subtask at the parent's occurrence", async () => {
    const t = await details([
      task('milk', { rrule: 'FREQ=DAILY', dtstart: '2026-10-01' }),
      task('skim', { parentId: id('milk') }),
    ]);
    await t.press(...down(AT.subtask), 'x');
    expect(t.lastFrame()).toContain('[x] skim');
    const mark = t.server.sent.find((op) => op.table === 'task_occurrence');
    expect(mark).toBeDefined();
  });

  it('says a subtask repeats with its parent', async () => {
    const t = await details([
      task('milk'),
      task('skim', { parentId: id('milk') }),
    ]);
    await t.press(KEY.escape, 'j', 'e');
    expect(t.lastFrame()).toContain('with its parent');
    const sent = t.server.sent.length;
    await t.press(...down(AT.repeat), KEY.enter);
    expect(t.lastFrame()).toContain('a subtask repeats with its parent');
    expect(t.server.sent.length).toBe(sent);
  });

  it('scrolls to a subtask past the height', async () => {
    const subs = Array.from({ length: 20 }, (_, i) =>
      task(`sub${String(i).padStart(2, '0')}`, {
        parentId: id('milk'),
        rank: `a${String(i).padStart(2, '0')}`,
      }),
    );
    const t = await details([task('milk'), ...subs]);
    expect(t.lastFrame()).not.toContain('sub19');
    await t.press(...down(AT.subtask + 19));
    expect(t.lastFrame()).toContain('sub19');
  });

  it('draws every line at the exact width with wide characters', async () => {
    const t = await details([
      task('牛乳を買う 🥛 とても長いタイトルがここにあります、もっと長く', {
        projectId: 'p-home',
      }),
    ]);
    await t.press(...down(AT.project), KEY.enter, '家🏠');
    for (const line of t.lines()) expect(visibleWidth(line)).toBe(80);
  });

  it('closes an open field when the shown task changes', async () => {
    const t = await details(
      [task('milk', { projectId: 'p-home' }), task('bread', { rank: 'a1' })],
      { width: 140 },
    );
    await t.press(...down(AT.project), KEY.enter, 'x');
    await t.engine.handle(
      {
        kind: 'deleteTask',
        opId: '00000000-0000-7000-a000-000000000003',
        taskId: id('milk'),
      },
      'tui',
    );
    await t.settle();
    expect(t.lastFrame()).toMatch(/Title\s+bread/);
    expect(mode(t)).toMatch(/^NORMAL/);
    expect(t.lastFrame()).not.toMatch(/Project\s+homex/);
  });

  it('leaves with q like Esc, back on the same task', async () => {
    const quit = vi.fn();
    const t = await details([task('milk'), task('bread', { rank: 'a1' })], {
      quit,
    });
    await t.press(KEY.escape, 'j', KEY.enter);
    expect(t.lastFrame()).toContain('Repeat');
    await t.press('q');
    expect(quit).not.toHaveBeenCalled();
    expect(t.lastFrame()).not.toContain('Repeat');
    expect(t.lastFrame()).toMatch(/▸ ○ bread/);
    expect(t.lastFrame()).toContain('j/k move');
  });
});

describe('DetailPane refusals', () => {
  /** Refuses every project change with `reason`: recorded (for good) unless
   *  it is NOT_APPLIED. */
  const refusing = (rows: Record<string, unknown>[], reason = 'not today') => {
    const server = fakeServer([
      status('s1', 'To do', 'a0'),
      project('p-home', 'home'),
      project('p-work', 'work'),
      ...rows,
    ]);
    server.state.refuse = (op) =>
      op.kind === 'set' && op.field === 'projectId' ? reason : undefined;
    return server;
  };
  const milk = [task('milk', { projectId: 'p-home' })];
  const projectOps = (t: Details) =>
    t.server.sent.filter((op) => op.kind === 'set' && op.field === 'projectId');
  const toWork = [...down(AT.project), KEY.enter, ...erase(4), 'work'];
  const hints = (t: Details) => plain(t.lines().at(-1) ?? '');

  it('a refused project change shows saved → yours · reason', async () => {
    const t = await details(milk, { server: refusing(milk) });
    await t.press(...toWork, KEY.enter);
    const at = t.rowOf('Project');
    expect(plain(t.lines()[at] ?? '')).toMatch(/^Project\s+✗ work\s*$/);
    expect(plain(t.lines()[at + 1] ?? '')).toMatch(
      /^\s+home → work · .*not today/,
    );
    // The fields below keep their order under the refusal line.
    expect(t.rowOf('Tags')).toBe(at + 2);
    expect(row(t)?.projectId).toBe('p-home');
  });

  it('a refusal for good offers no r; r syncs and resends nothing', async () => {
    const t = await details(milk, { server: refusing(milk) });
    await t.press(...toWork, KEY.enter);
    expect(hints(t)).not.toContain('r retry');
    expect(hints(t)).toContain('Enter edit');
    await t.press('r');
    expect(projectOps(t)).toHaveLength(1);
    expect(t.lastFrame()).toMatch(/Project\s+✗ work/);
  });

  it('a refusal for good: Enter reopens the value, saving it is a new opId', async () => {
    const t = await details(milk, { server: refusing(milk) });
    await t.press(...toWork, KEY.enter);
    delete t.server.state.refuse;
    await t.press(KEY.enter);
    expect(plain(t.lines()[t.rowOf('Project')] ?? '')).toMatch(
      /^Project\s+work\s*$/,
    );
    await t.press(KEY.enter);
    const ops = projectOps(t);
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opId).not.toBe(ops[0]?.opId);
    expect(t.lastFrame()).not.toContain('✗');
    expect(row(t)?.projectId).toBe('p-work');
  });

  it('a new project with its set refused keeps the value; saving again lands', async () => {
    const t = await details(milk, { server: refusing(milk) });
    await t.press(...down(AT.project), KEY.enter, ...erase(4), 'shop');
    await t.press(KEY.enter);
    // The project was created, the move into it refused.
    expect(t.store.rows('project').some((r) => r.name === 'shop')).toBe(true);
    expect(t.lastFrame()).toMatch(/Project\s+✗ shop/);
    delete t.server.state.refuse;
    await t.press(KEY.enter, KEY.enter);
    expect(t.lastFrame()).not.toContain('✗');
    expect(t.lastFrame()).toMatch(/^Project\s+shop\s*$/m);
    const ops = projectOps(t);
    expect(ops[1]?.opId).not.toBe(ops[0]?.opId);
  });

  it('a retryable refusal: r resends the same opId', async () => {
    const t = await details(milk, { server: refusing(milk, NOT_APPLIED) });
    await t.press(...toWork, KEY.enter);
    expect(hints(t)).toContain('r retry');
    await t.press('r');
    const ops = projectOps(t);
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opId).toBe(ops[0]?.opId);
    expect(t.lastFrame()).toMatch(/Project\s+✗ work/);
    // Judged afresh: once it is fine, the same opId lands.
    delete t.server.state.refuse;
    await t.press('r');
    expect(t.lastFrame()).not.toContain('✗');
    expect(row(t)?.projectId).toBe('p-work');
    expect(hints(t)).not.toContain('r retry');
  });

  it('a recorded refusal sticks to its opId', async () => {
    const server = refusing(milk);
    const t = await details(milk, { server });
    await t.press(...toWork, KEY.enter);
    const op = projectOps(t)[0];
    if (op === undefined) throw new Error('no project op sent');
    delete server.state.refuse;
    // The same opId again, as the backend replays its appliedOp record.
    const answer = await server.send({ since: 0, ops: [op] });
    const { results } = (await answer.json()) as { results: unknown[] };
    expect(results).toEqual([
      { opId: op.opId, status: 'rejected', reason: 'not today' },
    ]);
  });

  it('a new edit of a refused field is a new opId', async () => {
    const t = await details(milk, { server: refusing(milk) });
    await t.press(...toWork, KEY.enter);
    await t.press(KEY.enter, 's', KEY.enter);
    const ops = projectOps(t);
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opId).not.toBe(ops[0]?.opId);
    expect(t.lastFrame()).toMatch(/Project\s+✗ works/);
  });

  it('an older draft refused after a newer one applied shows nothing', async () => {
    const server = refusing(milk, NOT_APPLIED);
    server.state.refuse = (op) =>
      op.kind === 'set' && op.value === 'p-work' ? NOT_APPLIED : undefined;
    const t = await details(milk, { server });
    await t.press(...toWork);
    server.state.hold = true;
    t.input(KEY.enter);
    await server.until(1);
    t.input(KEY.enter, ...erase(10), 'shop', KEY.enter);
    await server.until(2);
    server.state.hold = false;
    // edit2's request is answered first, edit1's refusal comes last.
    server.held[1]?.();
    await vi.waitFor(() =>
      expect(t.store.rows('project').some((r) => r.name === 'shop')).toBe(true),
    );
    server.held[0]?.();
    await t.settle();
    expect(t.lastFrame()).not.toContain('✗');
    expect(t.lastFrame()).toMatch(/^Project\s+shop\s*$/m);
    // The superseded draft is never sent again, retryable as it was.
    const first = projectOps(t).find(
      (op) => op.kind === 'set' && op.value === 'p-work',
    )?.opId;
    const before = t.server.sent.filter((op) => op.opId === first).length;
    await t.press('r');
    expect(t.server.sent.filter((op) => op.opId === first)).toHaveLength(
      before,
    );
  });

  it('a new draft clears the refused one, so r cannot resend it', async () => {
    const server = refusing(milk, NOT_APPLIED);
    const t = await details(milk, { server });
    await t.press(...toWork, KEY.enter);
    const first = projectOps(t)[0]?.opId;
    server.state.hold = true;
    t.input(KEY.enter, 's', KEY.enter, 'r');
    await server.until(1);
    server.state.hold = false;
    server.held.forEach((release) => release());
    await t.settle();
    expect(projectOps(t).filter((op) => op.opId === first)).toHaveLength(1);
    expect(t.lastFrame()).toMatch(/Project\s+✗ works/);
  });

  it('Esc discards and shows the saved value', async () => {
    const t = await details(milk, { server: refusing(milk) });
    await t.press(...toWork, KEY.enter, KEY.escape);
    expect(t.lastFrame()).not.toContain('✗');
    expect(t.lastFrame()).toMatch(/^Project\s+home\s*$/m);
    // Esc took the refusal only: still in the details.
    expect(t.lastFrame()).toContain('Repeat');
  });

  it('a refusal for task A that arrives while task B is selected shows only on A', async () => {
    const rows = [...milk, task('bread', { rank: 'a1' })];
    const server = refusing(rows);
    const t = await details(rows, { server, width: 140 });
    await t.press(...toWork);
    server.state.hold = true;
    t.input(KEY.enter, KEY.escape, 'j');
    await server.until(1);
    server.state.hold = false;
    server.held.forEach((release) => release());
    await t.settle();
    const detail = () =>
      t
        .lines()
        .map((l) => plain(l).slice(140 - 48))
        .join('\n');
    expect(detail()).toMatch(/Title\s+bread/);
    expect(detail()).not.toContain('✗');
    await t.press('k');
    expect(detail()).toMatch(/Title\s+milk/);
    expect(detail()).toMatch(/Project\s+✗ work/);
  });

  it('an unreachable server is not a refusal', async () => {
    const t = await details(milk, { server: refusing(milk) });
    t.server.state.offline = true;
    await t.press(...toWork, KEY.enter);
    expect(mode(t)).toMatch(/1 queued/);
    expect(t.lastFrame()).not.toContain('✗');
    expect(t.lastFrame()).toMatch(/Project\s+work/);
  });

  for (const code of [401, 403, 429]) {
    it(`a ${String(code)} is no refusal: the edit waits in the outbox`, async () => {
      const t = await details(milk, { server: refusing(milk) });
      t.server.state.status = code;
      await t.press(...toWork, KEY.enter);
      expect(mode(t)).toMatch(/1 queued/);
      // The status line names why the write waits; the pane marks nothing.
      expect(mode(t)).toContain(`offline · 1 queued · `);
      expect(mode(t)).toContain(String(code));
      expect(t.lastFrame()).not.toContain('✗');
      expect(t.lastFrame()).toMatch(/^Project\s+work\s*$/m);
    });
  }
});
