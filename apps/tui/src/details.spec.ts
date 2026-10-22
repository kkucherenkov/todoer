import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, KEY, renderApp } from './test-kit.js';
import { Root } from './root.js';

let cleanup = () => {};
afterEach(() => cleanup());

const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

const status = (id: string, name: string, rank: string) => ({
  table: 'status',
  id,
  name,
  rank,
  completing: false,
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
const AT = { title: 0, project: 1, priority: 3, status: 4, due: 6, repeat: 7 };
const down = (n: number) => Array<string>(n).fill('j');

/** At 80 columns `e` shows the details full screen and Esc closes them. */
async function details(rows: Record<string, unknown>[] = [task('milk')]) {
  const t = await renderApp({
    width: 80,
    rows: 24,
    server: fakeServer([
      status('s1', 'To do', 'a0'),
      status('s2', 'Doing', 'a1'),
      ...rows,
    ]),
    app: (tui, size) => new Root({ tui, ...size, quit: () => undefined }),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.settle();
  await t.press('e');
  const lastFrame = () => t.lines().map(plain).join('\n');
  expect(lastFrame()).toContain('Repeat');
  return { ...t, lastFrame };
}
const row = (t: Awaited<ReturnType<typeof details>>, title = 'milk') =>
  t.store.rows('task').find((r) => r.id === id(title));

describe('DetailsScreen', () => {
  it('shows p0 for the highest priority and no label for P4', async () => {
    const hot = await details([task('milk', { priority: 0 })]);
    expect(hot.lastFrame()).toContain('p0');
    hot.cleanup();
    const plain = await details();
    expect(plain.lastFrame()).not.toMatch(/\bp\d\b/);
  });

  it('shows the fields and closes with Esc', async () => {
    const t = await details();
    for (const label of [
      'Title',
      'Project',
      'Tags',
      'Priority',
      'Status',
      'Scheduled',
      'Due',
      'Repeat',
      'Notes',
    ]) {
      expect(t.lastFrame()).toContain(label);
    }
    await t.press(KEY.escape);
    expect(t.lastFrame()).not.toContain('Repeat');
    expect(t.lastFrame()).toContain('milk');
  });

  it('saves one field alone and closes the line', async () => {
    const t = await details();
    await t.press(KEY.enter, ' and eggs', KEY.enter);
    expect(row(t)?.title).toBe('milk and eggs');
    await t.press(...down(AT.project), KEY.enter, 'home', KEY.enter);
    expect(t.lastFrame()).not.toContain('Project:');
    expect(t.lastFrame()).toContain('home');
    await t.press('j', KEY.enter, 'shop @x', KEY.enter);
    expect(t.lastFrame()).toContain('@shop @x');
  });

  it('keeps a refused line open with its text', async () => {
    const t = await details();
    await t.press(...down(AT.priority), KEY.enter, 'p9', KEY.enter);
    expect(t.lastFrame()).toContain('priority is p0 to p4');
    expect(t.lastFrame()).toContain('Priority: p9');
    await t.press(KEY.escape);
    expect(t.lastFrame()).not.toContain('Priority:');
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
    const erase = Array<string>(10).fill('\u007f');
    await t.press(...down(AT.due), KEY.enter, ...erase, KEY.enter);
    expect(row(t)?.dueOn).toBeNull();
  });

  it('moves the task through the status picker', async () => {
    const t = await details();
    await t.press(...down(AT.status), KEY.enter, 'j', KEY.enter);
    expect(row(t)?.statusId).toBe('s2');
  });

  it('makes the task repeat daily, and from a raw RRULE', async () => {
    const t = await details();
    await t.press(...down(AT.repeat), KEY.enter, 'j', KEY.enter);
    expect(row(t)?.rrule).toBe('FREQ=DAILY');
    // The picker's last row is the custom rule.
    await t.press(KEY.enter, ...down(5), KEY.enter);
    await t.press(...Array<string>(10).fill('\u007f'), 'FREQ=NEVER', KEY.enter);
    expect(t.lastFrame()).toContain('RRULE: FREQ=NEVER');
    expect(row(t)?.rrule).toBe('FREQ=DAILY');
  });

  it('refuses recurrence on a subtask and lists the subtasks', async () => {
    const t = await details([
      task('milk'),
      task('skim', { parentId: id('milk') }),
    ]);
    expect(t.lastFrame()).toContain('Subtasks');
    expect(t.lastFrame()).toContain('· skim');
    await t.press(KEY.escape, 'j', 'e');
    expect(t.lastFrame()).toContain('with its parent');
    const sent = t.server.sent.length;
    await t.press(...down(AT.repeat), KEY.enter);
    expect(t.lastFrame()).toContain('a subtask repeats with its parent');
    expect(t.server.sent.length).toBe(sent);
  });

  it('edits the notes in $VISUAL', async () => {
    const visual = process.env.VISUAL;
    process.env.VISUAL = "printf 'buy whole' >";
    try {
      const t = await details();
      await t.press(...down(8), KEY.enter);
      expect(row(t)?.notes).toBe('buy whole');
    } finally {
      if (visual === undefined) delete process.env.VISUAL;
      else process.env.VISUAL = visual;
    }
  });
});
