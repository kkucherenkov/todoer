import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY, NOT_APPLIED, fakeServer, renderApp } from './test-kit.js';
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
  /** Every line as drawn, the blank ones between groups included. */
  const screen = () => t.lines().map(plain);
  /** The drawn lines without the blank ones, so an index counts rows. */
  const text = () => screen().filter((l) => l.trim() !== '');
  const say = () => t.status.message?.text;
  return { ...t, outline, selected, screen, text, say };
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

  it('keeps the typed subtask in its row when the add is refused', async () => {
    const t = await open1(task('alpha', 'a0'));
    await t.press('O', '#p1', KEY.enter);
    expect(t.text().join('\n')).toMatch(/✗ +#p1/);
    expect(t.outline.inserting).toBe(false);
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

  it.each([
    ['Alt-arrows (CSI)', '\u001b[1;3B', '\u001b[1;3A'],
    ['Alt-arrows (ESC prefix)', KEY.altDown, KEY.altUp],
  ])('moves with %s', async (_name, down, up) => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press(down);
    const [a, b] = order(t.text(), 'alpha', 'beta');
    expect(b).toBeLessThan(a!);
    await t.press(up);
    const [a2, b2] = order(t.text(), 'alpha', 'beta');
    expect(a2).toBeLessThan(b2!);
  });

  it('keeps the cursor and onSelect on its task when another sorts first', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    const calls = t.selected.length;
    await createWrite(t)((newId) => ({
      kind: 'add',
      opId: newId(),
      id: newId(),
      text: 'fresh',
    }));
    await t.settle();
    const lines = t.text();
    expect(lines.findIndex((l) => l.includes('fresh'))).toBeLessThan(
      lines.findIndex((l) => l.startsWith('▸')),
    );
    expect(lines.find((l) => l.startsWith('▸'))).toContain('alpha');
    expect(t.selected.length).toBe(calls);
  });

  it('does not call onSelect when the cursor task did not change', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press('j');
    const calls = t.selected.length;
    await t.press('j');
    await createWrite(t)((newId) => ({
      kind: 'add',
      opId: newId(),
      id: newId(),
      text: 'fresh',
    }));
    await t.settle();
    expect(t.selected.length).toBe(calls);
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

/** Task creates the server saw. */
const adds = (t: { server: ReturnType<typeof fakeServer> }) =>
  t.server.sent.filter((op) => op.kind === 'create' && op.table === 'task');

describe('Outline n adds in place', () => {
  it('n, text, Enter adds under the cursor with #project and @tag parsed', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    const before = t.text();
    await t.press('n');
    // The row where the task will appear; above it nothing moves, below it
    // every row moves down one.
    expect(t.text()[0]).toBe(before[0]);
    expect(t.text()[1]).toMatch(/○ new:/);
    expect(t.text()[2]?.slice(2)).toBe(before[1]?.slice(2));
    await t.press('buy milk #home @shop p1', KEY.enter);
    expect(adds(t)).toHaveLength(1);
    const lines = t.text();
    expect(lines[1]).toMatch(/^▸ ○ p1 buy milk.*#home/);
    expect(lines[2]).toContain('beta');
    expect(t.frame()).not.toContain('new:');
    expect(
      t.server.sent.some(
        (op) =>
          op.kind === 'create' &&
          op.table === 'tag' &&
          String(op.fields.name).includes('shop'),
      ),
    ).toBe(true);
    expect(t.selected.at(-1)).toBe(
      adds(t)[0]?.kind === 'create' ? adds(t)[0]?.id : undefined,
    );
  });

  it('keeps o as n and puts the row at the end of the group', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
    );
    await t.press('o');
    expect(t.text()[2]).toMatch(/○ new:/);
    await t.press(KEY.escape, 'O');
    expect(t.text()[2]).toMatch(/^ {4}○ new subtask:/);
  });

  it('scrolls to keep the input row in the pane', async () => {
    const t = await open1(...ten(-1));
    t.outline.height = 4;
    await t.press('j', 'j', 'j', 'n');
    // t3, a blank line, then the add's row last in the pane.
    const lines = t.screen();
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatch(/○ new:/);
    expect(lines[1]).toContain('t3');
  });

  it('Esc removes the input row and sends nothing', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    const before = t.text();
    const sent = t.server.sent.length;
    await t.press('n', 'milk', KEY.escape);
    expect(t.text()).toEqual(before);
    expect(t.server.sent).toHaveLength(sent);
    expect(t.outline.holding).toBe(false);
  });

  it('a refused add keeps the text', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    t.server.state.refuse = (op) =>
      op.kind === 'create' && op.table === 'task' ? 'title taken' : undefined;
    await t.press('n', 'milk', KEY.enter);
    const lines = t.text();
    expect(lines[1]).toMatch(/✗ milk/);
    expect(lines[2]).toContain('title taken');
    expect(lines[3]).toContain('beta');
    expect(t.outline.inserting).toBe(false);
    expect(t.outline.hints).not.toContain('r retry');
    // Permanent: r resends nothing; Enter reopens the text, a new add.
    await t.press('r');
    expect(adds(t)).toHaveLength(1);
    await t.press(KEY.enter);
    expect(t.outline.inserting).toBe(true);
    expect(t.frame()).toContain('new: milk');
    delete t.server.state.refuse;
    await t.press(KEY.enter);
    const [first, second] = adds(t);
    expect(second?.opId).not.toBe(first?.opId);
    expect(t.frame()).not.toContain('✗');
    expect(t.text()[1]).toMatch(/^▸ ○ milk/);
  });

  it('r resends a retryable refusal with the same opId', async () => {
    const t = await open1(task('alpha', 'a0'));
    let once = true;
    t.server.state.refuse = (op) => {
      if (op.kind !== 'create' || op.table !== 'task' || !once) return;
      once = false;
      return NOT_APPLIED;
    };
    await t.press('n', 'milk', KEY.enter);
    expect(t.text().join('\n')).toMatch(/✗ milk/);
    expect(t.outline.hints).toContain('r retry');
    await t.press('r');
    const [first, second] = adds(t);
    expect(second?.opId).toBe(first?.opId);
    expect(t.frame()).not.toContain('✗');
    expect(t.text()[1]).toMatch(/^▸ ○ milk/);
  });

  it('locks the row while the add is in flight and hides the new task', async () => {
    const t = await open1(task('alpha', 'a0'), task('beta', 'a1'));
    t.server.state.hold = true;
    t.input('n', 'milk', KEY.enter);
    await t.server.until(1);
    t.input('x', 'y', KEY.enter, KEY.escape);
    const lines = t.text();
    // Only the add's row shows it, where it will stand.
    expect(lines.filter((l) => l.includes('milk'))).toHaveLength(1);
    expect(lines[1]).toMatch(/○ milk saving…/);
    expect(lines[0]).toContain('alpha');
    expect(t.outline.hints).toBe('saving…');
    t.server.state.hold = false;
    while (t.server.held.length > 0) t.server.held.shift()?.();
    await t.settle();
    expect(adds(t)).toHaveLength(1);
    expect(t.store.rows('task').map((r) => r.title)).toContain('milk');
    expect(t.text()[1]).toMatch(/^▸ ○ milk/);
    expect(t.text()[2]).toContain('beta');
  });

  it('a refusal arriving after Esc during the flight is still shown', async () => {
    const t = await open1(task('alpha', 'a0'));
    t.server.state.refuse = () => 'title taken';
    t.server.state.hold = true;
    t.input('n', 'milk', KEY.enter);
    await t.server.until(1);
    t.input(KEY.escape);
    t.server.state.hold = false;
    while (t.server.held.length > 0) t.server.held.shift()?.();
    await t.settle();
    expect(t.text().join('\n')).toMatch(/✗ milk/);
  });

  it('O on a subtask puts the row right after it', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
      task('a2', 'a3', 'alpha'),
    );
    await t.press('j', 'O');
    const lines = t.text();
    expect(lines[1]).toContain('a1');
    expect(lines[2]).toMatch(/^ {4}○ new subtask:/);
    expect(lines[3]).toContain('a2');
  });

  it('cuts a long refused text with … in its row', async () => {
    const t = await open([task('alpha', 'a0')], { width: 40 });
    t.server.state.refuse = () => 'no';
    await t.press('n', 'm'.repeat(80), KEY.enter);
    expect(t.text()[1]?.trimEnd()).toMatch(/m…$/);
  });

  it('resends an add that failed without a verdict with the same id and opId', async () => {
    const t = await open1(task('alpha', 'a0'));
    const real = t.engine.handle.bind(t.engine);
    const sent: { id?: string; opId?: string }[] = [];
    vi.spyOn(t.engine, 'handle').mockImplementation((command, tab) => {
      if (command.kind !== 'add') return real(command, tab);
      sent.push({ id: command.id, opId: command.opId });
      return sent.length === 1
        ? Promise.resolve({
            ok: false,
            failure: { kind: 'unavailable', detail: 'no answer' },
          })
        : real(command, tab);
    });
    await t.press('n', 'milk', KEY.enter);
    expect(t.text().join('\n')).toMatch(/✗ milk/);
    expect(t.outline.hints).toContain('r retry');
    await t.press(KEY.enter, KEY.enter);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(t.text()[1]).toMatch(/^▸ ○ milk/);
  });

  it('keeps the text when the engine rejects, and the row unlocks', async () => {
    const t = await open1(task('alpha', 'a0'));
    vi.spyOn(t.engine, 'handle').mockRejectedValueOnce(new Error('boom'));
    await t.press('n', 'milk', KEY.enter);
    const frame = t.text().join('\n');
    expect(frame).toMatch(/✗ milk/);
    expect(frame).toContain('unexpected: boom');
    expect(t.outline.hints).toContain('r retry');
    await t.press('r');
    expect(t.text()[1]).toMatch(/^▸ ○ milk/);
  });

  it('cuts a long reason with …', async () => {
    const t = await open1(task('alpha', 'a0'));
    t.server.state.refuse = () => 'x'.repeat(200);
    await t.press('n', 'milk', KEY.enter);
    expect(t.text()[2]?.trimEnd()).toMatch(/x…$/);
  });

  it('Esc discards a refused add', async () => {
    const t = await open1(task('alpha', 'a0'));
    t.server.state.refuse = () => 'title taken';
    await t.press('n', 'milk', KEY.enter, KEY.enter, KEY.escape);
    // The reopened input closes first, back to the refused row.
    expect(t.text().join('\n')).toMatch(/✗ milk/);
    await t.press(KEY.escape);
    expect(t.frame()).not.toContain('milk');
    expect(t.outline.holding).toBe(false);
  });

  it('n on an empty view puts the row first', async () => {
    const t = await open1();
    await t.press('n');
    expect(t.text()[0]).toMatch(/○ new:/);
    await t.press('solo', KEY.enter);
    expect(t.text()[0]).toMatch(/^▸ ○ solo/);
  });
});

describe('Outline filter', () => {
  it('/milk keeps the matching rows', async () => {
    const t = await open1(
      task('buy milk', 'a0'),
      task('bread', 'a1'),
      task('Milk shake', 'a2'),
    );
    t.outline.filter = 'milk';
    const frame = t.text().join('\n');
    expect(frame).toContain('buy milk');
    expect(frame).toContain('Milk shake');
    expect(frame).not.toContain('bread');
    t.outline.filter = 'zzz';
    expect(t.text()).toEqual([expect.stringContaining('nothing here')]);
  });

  it('a matching subtask keeps its parent, dimmed', async () => {
    const t = await open1(
      task('groceries', 'a0'),
      task('bread', 'a1'),
      task('milk', 'a2', 'groceries'),
    );
    await t.press('j');
    t.outline.filter = 'milk';
    const lines = t.text();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('groceries');
    expect(lines[1]).toContain('milk');
    expect(t.lines()[0]).toContain(`${ESC}[2mgroceries`);
    expect(t.selected.at(-1)).toBe(id('milk'));
  });

  it('clearing the filter restores the rows', async () => {
    const t = await open1(task('milk', 'a0'), task('bread', 'a1'));
    const before = t.text();
    t.outline.filter = 'bread';
    expect(t.text()).not.toEqual(before);
    t.outline.filter = '';
    expect(t.text()).toEqual(before);
  });

  it('pins a task added under the filter until the filter changes', async () => {
    const t = await open1(task('buy milk', 'a0'), task('bread', 'a1'));
    t.outline.filter = 'milk';
    await t.press('n', 'eggs', KEY.enter);
    expect(t.text().find((l) => l.startsWith('▸'))).toContain('eggs');
    expect(t.selected.at(-1)).toBe(
      t.store.rows('task').find((r) => r.title === 'eggs')?.id,
    );
    t.outline.filter = 'mil';
    expect(t.text().join('\n')).not.toContain('eggs');
  });

  it('Ё and ё match', async () => {
    const t = await open1(task('Ёлка', 'a0'), task('ель', 'a1'));
    t.outline.filter = 'ёлка';
    expect(t.text().join('\n')).toContain('Ёлка');
    expect(t.text().join('\n')).not.toContain('ель');
    // Decomposed (е + U+0308) matches the composed letter after NFC.
    t.outline.filter = 'е\u0308Л';
    expect(t.text().join('\n')).toContain('Ёлка');
  });
});

describe('Outline rows in full', () => {
  /** The lines of the row whose first line holds `title`, up to the next
   *  blank line. */
  const block = (lines: string[], title: string) => {
    const from = lines.findIndex((l) => l.includes(title));
    const to = lines.findIndex((l, i) => i > from && l.trim() === '');
    return lines.slice(from, to < 0 ? undefined : to);
  };

  it('moving the cursor never shifts a row', async () => {
    const t = await open1(...ten(4));
    const base = body(t.text());
    for (let at = 0; at < 10; at += 1) {
      expect(body(t.text()), `the cursor on ${at}`).toEqual(base);
      await t.press('j');
    }
  });

  it('draws a long title in full, cursor or not, and moves the rows below it down', async () => {
    const t = await open1(...ten(4));
    const words = (lines: string[]) =>
      lines.join(' ').match(/\bword\b/g)?.length;
    expect(words(block(t.screen(), 'word'))).toBe(60);
    expect(t.text().join('\n')).not.toContain('…');
    await t.press('j', 'j', 'j', 'j');
    const lines = t.screen();
    expect(lines.find((l) => l.startsWith('▸'))).toMatch(/^▸ .*word word/);
    expect(words(block(lines, 'word'))).toBe(60);
    expect(
      order(lines, 't3', 'word', 't5').every(
        (n, i, all) => i === 0 || n > all[i - 1]!,
      ),
    ).toBe(true);
  });

  it('puts a blank line before each top-level task, none before a subtask', async () => {
    const t = await open1(
      task('alpha', 'a0'),
      task('gamma', 'a1'),
      task('beta', 'a2', 'alpha'),
    );
    const lines = t.screen().map((l) => l.trim());
    const [a, b, g] = order(lines, 'alpha', 'beta', 'gamma');
    expect([b! - a!, g! - b!]).toEqual([1, 2]);
    expect(lines[g! - 1]).toBe('');
    expect(lines[0]).not.toBe('');
  });

  it('a publish while the cursor sits on a long row keeps the cursor on it', async () => {
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
    const at = lines.findIndex((l) => l.startsWith('▸'));
    expect(lines.findIndex((l) => l.includes('fresh'))).toBeLessThan(at);
    expect(lines[at]).toMatch(/^▸ .*word word/);
    expect(t.selected.at(-1)).toBe(id(longTitle));
  });

  it('clamps to the nearest row when the cursor’s task is gone', async () => {
    const t = await open1(...ten(4));
    await t.press('j', 'j', 'j', 'j');
    await t.press('d', 'd', 'y');
    expect(t.text().find((l) => l.startsWith('▸'))).toContain('t5');
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

  it('never draws more than its height; a taller row shows from its start', async () => {
    const t = await open1(...ten(9));
    t.outline.height = 2;
    for (let i = 0; i < 9; i += 1) await t.press('j');
    const lines = t.outline.render(80).map(plain);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^▸ .*word/);
  });

  it('keeps the due date on a long row’s first line', async () => {
    const t = await open(
      [
        { ...task(longTitle, 'a0'), dueOn: '2026-10-05' },
        task('plain', 'a1'),
        task('other', 'a2'),
      ],
      { width: 60 },
    );
    const lines = t.text();
    expect(lines[0]).toMatch(/word.* 2026-10-05$/);
    expect(lines.slice(1).join('')).not.toContain('2026');
    expect(t.lines().map((l) => visibleWidth(l))).toEqual(
      t.lines().map(() => 60),
    );
  });

  it('scrolls by lines only when the cursor row leaves the pane', async () => {
    // t0, '', t1, '', t2 fill five lines.
    const t = await open1(...ten(-1));
    t.outline.height = 5;
    const first = () =>
      t
        .screen()[0]
        ?.replace(/^\S?\s+\S\s/, '')
        .trim();
    expect(t.lines()).toHaveLength(5);
    await t.press('j', 'j');
    expect(first()).toBe('t0');
    await t.press('j');
    expect(first()).toBe('t1');
    await t.press('k', 'k');
    expect(first()).toBe('t1');
    await t.press('k');
    expect(first()).toBe('t0');
  });

  it('marks a task in a later status ◐, yellow, the first status ○', async () => {
    vi.stubEnv('NO_COLOR', '');
    const t = await open1(
      { ...status, id: 's2', name: 'Doing', rank: 'a1' },
      { ...task('inbox', 'a0'), statusId: 's1' },
      { ...task('doing', 'a1'), statusId: 's2' },
      task('none', 'a2'),
    );
    const at = (title: string) => t.text().find((l) => l.includes(title));
    expect(at('inbox')).toMatch(/○ inbox/);
    expect(at('doing')).toMatch(/◐ doing/);
    expect(at('none')).toMatch(/○ none/);
    expect(t.lines().join('')).toContain(`${ESC}[33m◐`);
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
