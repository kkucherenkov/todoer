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
  priority: 0,
  version: 1,
  ...(parent === undefined ? {} : { parentId: id(parent) }),
});

async function open(...rows: Record<string, unknown>[]) {
  const t = await renderTui(<App />, {
    server: fakeServer([status, ...rows]),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.settle();
  return t;
}

const lines = (frame: string | undefined) =>
  (frame ?? '').split('\n').map((l) => l.trim());
const order = (frame: string | undefined, ...titles: string[]) => {
  const all = lines(frame);
  return titles.map((s) => all.findIndex((l) => l.includes(s)));
};

describe('OutlinePane', () => {
  it('nests a subtask under its parent and folds it with h', async () => {
    const t = await open(
      task('alpha', 'a0'),
      task('gamma', 'a1'),
      task('beta', 'a2', 'alpha'),
    );
    expect(order(t.lastFrame(), 'alpha', 'beta', 'gamma')).toEqual(
      [0, 1, 2].map((i) => order(t.lastFrame(), 'alpha')[0]! + i),
    );
    await t.press('h');
    expect(t.lastFrame()).not.toContain('beta');
    expect(t.lastFrame()).toContain('+1');
    await t.press('l');
    expect(t.lastFrame()).toContain('beta');
  });

  it('indents with Tab and outdents with Shift-Tab', async () => {
    const t = await open(task('alpha', 'a0'), task('gamma', 'a1'));
    await t.press('j', KEY.tab);
    const row = () => t.store.rows('task').find((r) => r.id === id('gamma'));
    expect(row()?.parentId).toBe(id('alpha'));
    await t.press(KEY.shiftTab);
    expect(row()?.parentId ?? null).toBeNull();
  });

  it('refuses to indent a task that has subtasks, on the status line', async () => {
    const t = await open(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('beta1', 'a2', 'beta'),
    );
    await t.press('j', KEY.tab);
    expect(t.lastFrame()).toMatch(/subtasks cannot become a subtask/);
  });

  it('says there is nothing to indent under on the first row', async () => {
    const t = await open(task('alpha', 'a0'));
    await t.press(KEY.tab);
    expect(t.lastFrame()).toMatch(/nothing above to indent under/);
  });

  it('adds a task with o and a subtask of it with O', async () => {
    const t = await open(task('alpha', 'a0'));
    await t.press('o', 'solo', KEY.enter, 'O', 'child', KEY.enter);
    const rows = t.store.rows('task');
    const solo = rows.find((r) => r.title === 'solo');
    expect(solo?.parentId ?? null).toBeNull();
    expect(rows.find((r) => r.title === 'child')?.parentId).toBe(solo?.id);
  });

  it('adds a sibling with O on a subtask', async () => {
    const t = await open(task('alpha', 'a0'), task('beta', 'a1', 'alpha'));
    await t.press('j', 'O', 'second', KEY.enter);
    const second = t.store.rows('task').find((r) => r.title === 'second');
    expect(second?.parentId).toBe(id('alpha'));
  });

  it('inserts with o below the cursor’s whole group and moves the cursor to it', async () => {
    const t = await open(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
    );
    await t.press('o', 'new', KEY.enter);
    const [alpha, a1, fresh, beta] = order(
      t.lastFrame(),
      'alpha',
      'a1',
      'new',
      'beta',
    );
    expect([a1, fresh, beta]).toEqual([alpha! + 1, alpha! + 2, alpha! + 3]);
    await t.press('d', 'd');
    expect(t.lastFrame()).toContain('delete "new"?');
  });

  it('inserts with o on a subtask a top-level task after its parent’s group', async () => {
    const t = await open(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
      task('a2', 'a3', 'alpha'),
    );
    await t.press('j', 'o', 'new', KEY.enter);
    const [a2, fresh, beta] = order(t.lastFrame(), 'a2', 'new', 'beta');
    expect([fresh, beta]).toEqual([a2! + 1, a2! + 2]);
    const row = t.store.rows('task').find((r) => r.title === 'new');
    expect(row?.parentId ?? null).toBeNull();
  });

  it('inserts with O after the subtask under the cursor, else last', async () => {
    const t = await open(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('a1', 'a2', 'alpha'),
      task('a2', 'a3', 'alpha'),
    );
    await t.press('j', 'O', 'mid', KEY.enter);
    const [a1, mid, a2] = order(t.lastFrame(), 'a1', 'mid', 'a2');
    expect([mid, a2]).toEqual([a1! + 1, a1! + 2]);
    await t.press('d', 'd');
    expect(t.lastFrame()).toContain('delete "mid"?');
    await t.press('n', 'k', 'k', 'O', 'end', KEY.enter);
    const [last, end, beta] = order(t.lastFrame(), 'a2', 'end', 'beta');
    expect([end, beta]).toEqual([last! + 1, last! + 2]);
  });

  it('leaves placing a new task to the sort in a view that sorts itself', async () => {
    const t = await open(byPriority, task('alpha', 'a0'), task('beta', 'a1'));
    await t.press(']', 'o', 'new', KEY.enter);
    expect(
      t.server.sent.filter((op) => op.kind === 'set' && op.field === 'rank'),
    ).toEqual([]);
    // Where the engine put it, not below the cursor.
    const [fresh, alpha] = order(t.lastFrame(), 'new', 'alpha');
    expect(fresh).toBeLessThan(alpha!);
  });

  it('keeps the typed subtask open when the add is refused', async () => {
    const t = await open(task('alpha', 'a0'));
    await t.press('O', '#p1', KEY.enter);
    expect(t.lastFrame()).toContain('new subtask:');
    expect(t.lastFrame()).toContain('#p1');
  });

  it('moves a task among its siblings with J and K in a manual view', async () => {
    const t = await open(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press('J');
    const [a, b] = order(t.lastFrame(), 'alpha', 'beta');
    expect(b).toBeLessThan(a!);
    await t.press('K');
    const [a2, b2] = order(t.lastFrame(), 'alpha', 'beta');
    expect(a2).toBeLessThan(b2!);
  });

  it('moves with Alt-↓ and Alt-↑ too', async () => {
    const t = await open(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press(KEY.altDown);
    const [a, b] = order(t.lastFrame(), 'alpha', 'beta');
    expect(b).toBeLessThan(a!);
    await t.press(KEY.altUp);
    const [a2, b2] = order(t.lastFrame(), 'alpha', 'beta');
    expect(a2).toBeLessThan(b2!);
  });

  it('refuses to move in a view that sorts itself', async () => {
    const t = await open(byPriority, task('alpha', 'a0'), task('beta', 'a1'));
    await t.press(']');
    const sent = t.server.sent.length;
    await t.press('J');
    expect(t.lastFrame()).toMatch(/moving needs a manual view/);
    expect(t.server.sent.length).toBe(sent);
  });

  it('works the shared task keys on a subtask row', async () => {
    const t = await open(task('alpha', 'a0'), task('beta', 'a1', 'alpha'));
    await t.press('j', 'x');
    expect(t.lastFrame()).not.toContain('beta');
  });
});
