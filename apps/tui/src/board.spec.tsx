import { afterEach, describe, expect, it } from 'vitest';
import { App } from './app.js';
import { fakeServer, KEY, renderTui } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

const status = (
  id: string,
  name: string,
  rank: string,
  completing = false,
) => ({ table: 'status', id, name, rank, completing, version: 1 });
const view = (sort: string) => ({
  table: 'view',
  id: 'v1',
  name: 'Board',
  layout: 'kanban',
  sort,
  filter: { and: [] },
  rank: 'a0',
  version: 1,
});
const task = (id: string, statusId: string, rank: string, more = {}) => ({
  table: 'task',
  id,
  title: id,
  statusId,
  rank,
  priority: 0,
  version: 1,
  ...more,
});
const STATUSES = [
  status('todo', 'To do', 'a0'),
  status('doing', 'Doing', 'a1'),
  status('done', 'Done', 'a2', true),
];

async function open({
  statuses = STATUSES,
  sort = 'manual',
  tasks = [task('alpha', 'todo', 'a0'), task('beta', 'todo', 'a1')],
} = {}) {
  const t = await renderTui(<App />, {
    server: fakeServer([...statuses, view(sort), ...tasks]),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.press(']'); // All open → Board
  return t;
}
type T = Awaited<ReturnType<typeof open>>;
const row = (t: T, id: string) => t.store.rows('task').find((r) => r.id === id);
/** The highlighted card's text: the pane is right of the sidebar's `││`. */
const cursor = (t: T) =>
  (t.lastFrame() ?? '')
    .split('\n')
    .map((l) => l.split('││').at(-1) ?? '')
    .find((l) => l.includes('▸ '))
    ?.split('▸ ')[1];

describe('BoardPane', () => {
  it('shows a column per status with its cards, a subtask named by its parent', async () => {
    const t = await open({
      tasks: [
        task('alpha', 'todo', 'a0'),
        task('beta', 'doing', 'a0', { parentId: 'alpha' }),
      ],
    });
    const frame = t.lastFrame() ?? '';
    for (const name of ['To do', 'Doing', 'Done ✓', 'alpha', 'alpha › beta']) {
      expect(frame).toContain(name);
    }
  });

  it('moves the cursor with h/l across columns and j/k along cards', async () => {
    const t = await open({
      tasks: [
        task('alpha', 'todo', 'a0'),
        task('beta', 'todo', 'a1'),
        task('gamma', 'doing', 'a0'),
      ],
    });
    expect(cursor(t)).toContain('alpha');
    await t.press('j');
    expect(cursor(t)).toContain('beta');
    await t.press('l');
    expect(cursor(t)).toContain('gamma');
    await t.press(KEY.left, 'k');
    expect(cursor(t)).toContain('alpha');
  });

  it('moves a card right with L, the cursor follows it, and into Done marks it done', async () => {
    const t = await open();
    await t.press('L');
    expect(row(t, 'alpha')?.statusId).toBe('doing');
    expect(cursor(t)).toContain('alpha');
    await t.press('L');
    expect(t.lastFrame()).toMatch(/marked done/);
    expect(cursor(t)).toContain('alpha');
    await t.press('H');
    expect(row(t, 'alpha')?.statusId).toBe('doing');
    expect(t.lastFrame()).toMatch(/marked undo/);
  });

  it('reorders within a column with J/K in a manual view', async () => {
    const t = await open();
    await t.press('J');
    const rank = (id: string) => String(row(t, id)?.rank);
    expect(rank('alpha') > rank('beta')).toBe(true);
    expect(cursor(t)).toContain('alpha');
    await t.press('K');
    expect(rank('alpha') < rank('beta')).toBe(true);
  });

  it('says why J does nothing in a view that sorts itself', async () => {
    const t = await open({ sort: 'priority' });
    const before = String(row(t, 'alpha')?.rank);
    await t.press('J');
    expect(t.lastFrame()).toMatch(/manual view/);
    expect(String(row(t, 'alpha')?.rank)).toBe(before);
  });

  it('adds a card to the current column with o', async () => {
    const t = await open();
    await t.press('l', 'o', 'gamma', KEY.enter);
    const gamma = t.store.rows('task').find((r) => r.title === 'gamma');
    expect(gamma?.statusId).toBe('doing');
    expect(t.lastFrame()).not.toContain('new:');
    expect(cursor(t)).toContain('gamma');
  });

  it('inserts with o right below the current card in a manual view', async () => {
    const t = await open({
      tasks: [
        task('alpha', 'todo', 'a0'),
        task('beta', 'todo', 'a1'),
        task('delta', 'doing', 'a0'),
        task('eps', 'doing', 'a1'),
      ],
    });
    const rank = (title: string) =>
      String(t.store.rows('task').find((r) => r.title === title)?.rank);
    await t.press('o', 'gamma', KEY.enter);
    expect(rank('alpha') < rank('gamma') && rank('gamma') < rank('beta')).toBe(
      true,
    );
    expect(cursor(t)).toContain('gamma');
    await t.press('l', 'o', 'zeta', KEY.enter);
    expect(rank('delta') < rank('zeta') && rank('zeta') < rank('eps')).toBe(
      true,
    );
    expect(cursor(t)).toContain('zeta');
  });

  it('sends only the add in a view that sorts itself', async () => {
    const t = await open({ sort: 'priority' });
    await t.press('o', 'gamma', KEY.enter);
    expect(
      t.server.sent.filter((op) => op.kind === 'set' && op.field === 'rank'),
    ).toEqual([]);
  });

  it('keeps the new card’s text when the add is refused', async () => {
    const t = await open();
    await t.press('o', '   ', KEY.enter);
    expect(t.lastFrame()).toContain('new:');
    expect(t.store.rows('task')).toHaveLength(2);
  });

  it('opens the status picker on a card with m', async () => {
    const t = await open();
    await t.press('m');
    expect(t.lastFrame()).toContain('Status');
  });

  it('scrolls the columns that do not fit with the cursor', async () => {
    const t = await open({
      statuses: ['a', 'b', 'c', 'd', 'e'].map((s, i) =>
        status(s, `Col ${s}`, `a${i}`),
      ),
      tasks: [],
    });
    expect(t.lastFrame()).toContain('columns 1–3 of 5');
    expect(t.lastFrame()).not.toContain('Col e');
    await t.press('l', 'l', 'l', 'l');
    expect(t.lastFrame()).toContain('columns 3–5 of 5');
    expect(t.lastFrame()).toContain('Col e');
  });
});
