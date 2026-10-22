import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY, fakeServer, renderApp } from './pi/test-kit.js';
import { Outline } from './outline.js';
import { createWrite } from './write.js';

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const status = {
  table: 'status',
  id: 's1',
  name: 'To do',
  rank: 'a0',
  completing: false,
  version: 1,
};
const byPriority = {
  table: 'view',
  id: 'v1',
  name: 'Urgent',
  layout: 'list',
  sort: 'priority',
  filter: { and: [] },
  rank: 'a0',
  version: 1,
};
/** Task ids must be uuids (an id suffix is how the engine finds a task);
 *  the title names the task in a spec. */
const ids: Record<string, string> = {};
const id = (title: string) =>
  (ids[title] ??= `00000000-0000-7000-9000-${Object.keys(ids)
    .length.toString(16)
    .padStart(12, '0')}`);
const task = (title: string, rank: string, parent?: string) => ({
  table: 'task',
  id: id(title),
  title,
  rank,
  priority: 4,
  version: 1,
  ...(parent === undefined ? {} : { parentId: id(parent) }),
});

const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

async function open(
  rows: Record<string, unknown>[],
  { key = 'all', width = 80 }: { key?: string; width?: number } = {},
) {
  let outline!: Outline;
  const selected: (string | null)[] = [];
  const t = await renderApp({
    width,
    server: fakeServer([status, ...rows]),
    app: (tui) =>
      (outline = new Outline({ tui, onSelect: (s) => selected.push(s) })),
  });
  cleanup = t.cleanup;
  outline.show(key);
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.engine.handle({ kind: 'watch', view: key, task: null }, 'tui');
  await t.settle();
  const text = () => t.lines().map(plain);
  const say = () => t.status.message?.text;
  return { ...t, outline, selected, text, say };
}

const order = (lines: string[], ...titles: string[]) =>
  titles.map((s) => lines.findIndex((l) => l.includes(s)));
const open1 = (...rows: Record<string, unknown>[]) => open(rows);

describe('Outline', () => {
  it('labels P0 and leaves P4 unlabelled', async () => {
    const t = await open1(
      { ...task('alpha', 'a0'), priority: 0 },
      task('gamma', 'a1'),
    );
    const at = (title: string) => t.text().find((l) => l.includes(title)) ?? '';
    expect(at('alpha')).toContain('p0');
    expect(at('gamma')).toContain('gamma');
    expect(at('gamma')).not.toMatch(/\bp\d\b/);
  });

  it('shows due, subtask progress and project on the right', async () => {
    const t = await open1(
      { ...task('alpha', 'a0'), dueOn: '2026-10-05' },
      task('beta', 'a1', 'alpha'),
    );
    const row = t.text().find((l) => l.includes('alpha')) ?? '';
    expect(row.trimEnd()).toMatch(/2026-10-05 0\/1$/);
    await t.press('o', 'milk #home', KEY.enter);
    expect(t.text().find((l) => l.includes('milk'))).toMatch(/#home\s*$/);
    expect(visibleWidth(row)).toBe(80);
  });

  it('nests a subtask under its parent and folds it with h', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('gamma', 'a1'),
      task('beta', 'a2', 'alpha'),
    );
    const [a] = order(t.text(), 'alpha');
    expect(order(t.text(), 'alpha', 'beta', 'gamma')).toEqual([
      a,
      a! + 1,
      a! + 2,
    ]);
    await t.press('h');
    expect(t.frame()).not.toContain('beta');
    expect(t.frame()).toContain('+1');
    await t.press('l');
    expect(t.frame()).toContain('beta');
  });

  it('indents with > and outdents with <', async () => {
    const t = await open1(task('alpha', 'a0'), task('gamma', 'a1'));
    await t.press('j', '>');
    const row = () => t.store.rows('task').find((r) => r.id === id('gamma'));
    expect(row()?.parentId).toBe(id('alpha'));
    await t.press('<');
    expect(row()?.parentId ?? null).toBeNull();
  });

  it('refuses to indent a task that has subtasks, on the status line', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('beta1', 'a2', 'beta'),
    );
    await t.press('j', '>');
    expect(t.say()).toMatch(/subtasks cannot become a subtask/);
  });

  it('says there is nothing to indent under on the first row', async () => {
    const t = await open1(task('alpha', 'a0'));
    await t.press('>');
    expect(t.say()).toMatch(/nothing above to indent under/);
  });

  it('leaves Tab to the root', async () => {
    const t = await open1(task('alpha', 'a0'), task('gamma', 'a1'));
    await t.press('j', KEY.tab);
    expect(
      t.store.rows('task').find((r) => r.id === id('gamma'))?.parentId ?? null,
    ).toBeNull();
  });

  it('adds a task with o and a subtask of it with O', async () => {
    const t = await open1(task('alpha', 'a0'));
    await t.press('o', 'solo', KEY.enter, 'O', 'child', KEY.enter);
    const rows = t.store.rows('task');
    const solo = rows.find((r) => r.title === 'solo');
    expect(solo?.parentId ?? null).toBeNull();
    expect(rows.find((r) => r.title === 'child')?.parentId).toBe(solo?.id);
  });

  it('cancels an add with Esc', async () => {
    const t = await open1(task('alpha', 'a0'));
    await t.press('o', 'solo', KEY.escape);
    expect(t.store.rows('task').some((r) => r.title === 'solo')).toBe(false);
    expect(t.frame()).not.toContain('new:');
  });

  it('adds a sibling with O on a subtask', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1', 'alpha'));
    await t.press('j', 'O', 'second', KEY.enter);
    const second = t.store.rows('task').find((r) => r.title === 'second');
    expect(second?.parentId).toBe(id('alpha'));
  });

  it('inserts with o below the cursor’s whole group and moves the cursor to it', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
    );
    await t.press('o', 'new', KEY.enter);
    const [alpha, a1, fresh, beta] = order(
      t.text(),
      'alpha',
      'a1',
      'new',
      'beta',
    );
    expect([a1, fresh, beta]).toEqual([alpha! + 1, alpha! + 2, alpha! + 3]);
    await t.press('d', 'd');
    expect(t.say()).toContain('delete "new"?');
  });

  it('inserts with o on a subtask a top-level task after its parent’s group', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
      task('a2', 'a3', 'alpha'),
    );
    await t.press('j', 'o', 'new', KEY.enter);
    const [a2, fresh, beta] = order(t.text(), 'a2', 'new', 'beta');
    expect([fresh, beta]).toEqual([a2! + 1, a2! + 2]);
    const row = t.store.rows('task').find((r) => r.title === 'new');
    expect(row?.parentId ?? null).toBeNull();
  });

  it('inserts with O after the subtask under the cursor, else last', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
      task('a2', 'a3', 'alpha'),
    );
    await t.press('j', 'O', 'mid', KEY.enter);
    const [a1, mid, a2] = order(t.text(), 'a1', 'mid', 'a2');
    expect([mid, a2]).toEqual([a1! + 1, a1! + 2]);
    await t.press('d', 'd');
    expect(t.say()).toContain('delete "mid"?');
    await t.press('n', 'k', 'k', 'O', 'end', KEY.enter);
    const [last, end, beta] = order(t.text(), 'a2', 'end', 'beta');
    expect([end, beta]).toEqual([last! + 1, last! + 2]);
  });

  it('deletes with dd and y, and keeps the task on any other key', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press('d', 'd', 'n');
    expect(t.frame()).toContain('alpha');
    await t.press('d', 'd', 'y');
    expect(t.frame()).not.toContain('alpha');
    expect(t.frame()).toContain('beta');
  });

  it('marks done with x and undoes it with x again', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press('x');
    expect(t.frame()).not.toContain('alpha');
    expect(t.say()).toMatch(/marked done/);
  });

  it('marks done with Space and skips with s', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('gamma', 'a2'),
    );
    await t.press(' ');
    expect(t.frame()).not.toContain('alpha');
    await t.press('s');
    expect(t.frame()).not.toContain('beta');
    expect(t.frame()).toContain('gamma');
  });

  it('leaves placing a new task to the sort in a view that sorts itself', async () => {
    const t = await open(
      [byPriority, task('alpha', 'a0'), task('beta', 'a1')],
      { key: 'v1' },
    );
    await t.press('o', 'new', KEY.enter);
    expect(
      t.server.sent.filter((op) => op.kind === 'set' && op.field === 'rank'),
    ).toEqual([]);
    // Where the engine put it, not below the cursor.
    const [fresh, alpha] = order(t.text(), 'new', 'alpha');
    expect(fresh).toBeLessThan(alpha!);
  });

  it('keeps the typed subtask open when the add is refused', async () => {
    const t = await open1(task('alpha', 'a0'));
    await t.press('O', '#p1', KEY.enter);
    expect(t.frame()).toContain('new subtask:');
    expect(t.frame()).toContain('#p1');
  });

  it('moves a task among its siblings with J and K in a manual view', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press('J');
    const [a, b] = order(t.text(), 'alpha', 'beta');
    expect(b).toBeLessThan(a!);
    await t.press('K');
    const [a2, b2] = order(t.text(), 'alpha', 'beta');
    expect(a2).toBeLessThan(b2!);
  });

  it('refuses to move in a view that sorts itself', async () => {
    const t = await open(
      [byPriority, task('alpha', 'a0'), task('beta', 'a1')],
      { key: 'v1' },
    );
    const sent = t.server.sent.length;
    await t.press('J');
    expect(t.say()).toMatch(/moving needs a manual view/);
    expect(t.server.sent.length).toBe(sent);
  });

  it('works the shared task keys on a subtask row', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1', 'alpha'));
    await t.press('j', 'x');
    expect(t.frame()).not.toContain('beta');
  });

  it('tells onSelect which task the cursor is on, and null when none', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    expect(t.selected.at(-1)).toBe(id('alpha'));
    await t.press('j');
    expect(t.selected.at(-1)).toBe(id('beta'));
    await t.press('k', 'x', 'x');
    expect(t.selected.at(-1)).toBeNull();
  });
});

/** Ten tasks, the one at `long` with a title that needs more than 3 lines. */
const longTitle = 'word '.repeat(60).trim();
const ten = (long: number) =>
  Array.from({ length: 10 }, (_, i) =>
    task(i === long ? longTitle : `t${i}`, `a${i}`),
  );
/** A row without the cursor mark in front of it. */
const body = (lines: string[]) => lines.map((l) => l.slice(2));

describe('Outline cursor row', () => {
  it('moving the cursor never shifts a row', async () => {
    const t = await open1(...ten(4));
    const base = body(t.text());
    for (let at = 0; at < 10; at += 1) {
      const now = body(t.text());
      for (let i = 0; i < 10; i += 1) {
        if (i >= at && i <= at + 2) continue;
        expect(now[i], `row ${i} with the cursor on ${at}`).toBe(base[i]);
      }
      await t.press('j');
    }
  });

  it('shows the long title over the two rows under it', async () => {
    const t = await open1(...ten(4));
    await t.press('j', 'j', 'j', 'j');
    const lines = t.text();
    expect(lines[3]).toContain('t3');
    expect(lines[4]).toMatch(/^▸ .*word word/);
    expect(lines[6]?.trimEnd().endsWith('…')).toBe(true);
    expect(lines[7]).toContain('t7');
    expect(lines.filter((l) => l.includes('t5') || l.includes('t6'))).toEqual(
      [],
    );
    await t.press('j');
    expect(t.text()[5]).toContain('t5');
  });

  it('a long cursor row grows upward at the bottom', async () => {
    const t = await open1(...ten(9));
    const base = body(t.text());
    for (let i = 0; i < 9; i += 1) await t.press('j');
    const lines = t.text();
    expect(lines.slice(7, 10).every((l) => l.includes('word'))).toBe(true);
    expect(lines[9]?.startsWith('▸')).toBe(false);
    expect(lines[9]?.trimEnd().endsWith('…')).toBe(true);
    expect(body(lines).slice(0, 7)).toEqual(base.slice(0, 7));
  });

  it('a publish while the cursor sits on a long row keeps the overlay on that row', async () => {
    const t = await open1(...ten(4));
    await t.press('j', 'j', 'j', 'j');
    // An unrelated add lands above the cursor and pushes its row down.
    await createWrite(t)((newId) => ({
      kind: 'add',
      opId: newId(),
      id: newId(),
      text: 'fresh',
    }));
    await t.settle();
    const lines = t.text();
    expect(lines.findIndex((l) => l.includes('fresh'))).toBeLessThan(5);
    expect(lines[5]).toMatch(/^▸ .*word word/);
    expect(t.selected.at(-1)).toBe(id(longTitle));
  });

  it('clamps to the nearest row when the cursor’s task is gone', async () => {
    const t = await open1(...ten(4));
    await t.press('j', 'j', 'j', 'j');
    await t.press('d', 'd', 'y');
    const lines = t.text();
    expect(lines.findIndex((l) => l.startsWith('▸'))).toBe(4);
    expect(lines[4]).toContain('t5');
    expect(t.selected.at(-1)).toBe(id('t5'));
  });

  it('keeps every row exactly the outline width, CJK or not', async () => {
    const cjk = '日本語のタイトル'.repeat(12);
    const t = await open(
      [
        { ...task(cjk, 'a0'), project: 'ホーム' },
        task('日本語 short', 'a1'),
        task('plain', 'a2'),
      ],
      { width: 41 },
    );
    for (let i = 0; i < 3; i += 1) {
      const lines = t.lines();
      expect(lines.map((l) => visibleWidth(l))).toEqual(lines.map(() => 41));
      await t.press('j');
    }
  });

  it('scrolls only when the cursor leaves the pane', async () => {
    const t = await open1(...ten(-1));
    t.outline.height = 5;
    const first = () =>
      t
        .text()[0]
        ?.replace(/^\S?\s+\S\s/, '')
        .trim();
    expect(t.lines()).toHaveLength(5);
    await t.press('j', 'j', 'j', 'j');
    expect(first()).toBe('t0');
    await t.press('j');
    expect(first()).toBe('t1');
    await t.press('k');
    expect(first()).toBe('t1');
    await t.press('k', 'k', 'k', 'k');
    expect(first()).toBe('t0');
  });

  it('draws no colour under NO_COLOR', async () => {
    vi.stubEnv('NO_COLOR', '1');
    const t = await open1({ ...task('alpha', 'a0'), priority: 1 });
    expect(t.lines().join('')).not.toMatch(new RegExp(`${ESC}\\[3\\d`));
    expect(plain(t.lines()[0]!)).toContain('p1');
  });

  it('colours a high priority', async () => {
    vi.stubEnv('NO_COLOR', '');
    const t = await open1({ ...task('alpha', 'a0'), priority: 1 });
    expect(t.lines().join('')).toMatch(new RegExp(`${ESC}\\[31m`));
  });
});
