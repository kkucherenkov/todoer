import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, KEY, renderApp } from './test-kit.js';
import { Root } from './root.js';

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

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
/** Task ids are uuids; the title names the task in a spec. */
const ids: Record<string, string> = {};
const id = (title: string) =>
  (ids[title] ??= `00000000-0000-7000-9000-${Object.keys(ids)
    .length.toString(16)
    .padStart(12, '0')}`);
const task = (title: string, statusId: string, rank: string, more = {}) => ({
  table: 'task',
  id: id(title),
  title,
  statusId,
  rank,
  priority: 4,
  version: 1,
  ...more,
});
const STATUSES = [
  status('todo', 'To do', 'a0'),
  status('doing', 'Doing', 'a1'),
  status('done', 'Done', 'a2', true),
];

/** At 100 columns the board fills the frame. */
async function open({
  statuses = STATUSES,
  sort = 'manual',
  tasks = [task('alpha', 'todo', 'a0'), task('beta', 'todo', 'a1')],
  width = 100,
  rows = 30,
} = {}) {
  const t = await renderApp({
    width,
    rows,
    server: fakeServer([...statuses, view(sort), ...tasks]),
    app: (tui, size) => new Root({ tui, ...size, quit: () => undefined }),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.press('['); // All open → Board, the last row
  const text = () => t.lines().map(plain);
  return { ...t, text, lastFrame: () => text().join('\n') };
}
type T = Awaited<ReturnType<typeof open>>;
const row = (t: T, title: string) =>
  t.store.rows('task').find((r) => r.title === title);
/** The highlighted card's text, up to the next column. */
const cursor = (t: T) =>
  t
    .lastFrame()
    .split('\n')
    .find((l) => l.includes('▸ '))
    ?.split('▸ ')[1]
    ?.split('  ')[0];

describe('BoardPane', () => {
  it('shows a column per status with its cards, a subtask named by its parent', async () => {
    const t = await open({
      tasks: [
        task('alpha', 'todo', 'a0'),
        task('beta', 'doing', 'a0', { parentId: id('alpha') }),
      ],
    });
    const frame = t.lastFrame();
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
    // A card already in Doing: the cursor must follow alpha, not row 0.
    const t = await open({
      tasks: [
        task('alpha', 'todo', 'a0'),
        task('beta', 'todo', 'a1'),
        task('aardvark', 'doing', 'Zz'),
      ],
    });
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
    const rank = (title: string) => String(row(t, title)?.rank);
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
    expect(row(t, 'gamma')?.statusId).toBe('doing');
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
    const rank = (title: string) => String(row(t, title)?.rank);
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
    expect(t.lastFrame()).toContain('columns 1–4 of 5');
    expect(t.lastFrame()).not.toContain('Col e');
    await t.press('l', 'l', 'l', 'l');
    expect(t.lastFrame()).toContain('columns 2–5 of 5');
    expect(t.lastFrame()).toContain('Col e');
  });

  it('scrolls a column so the cursor card is always drawn', async () => {
    const tasks = Array.from({ length: 40 }, (_, i) =>
      task(
        `card${String(i).padStart(2, '0')}`,
        'todo',
        `a${String(i).padStart(2, '0')}`,
      ),
    );
    const t = await open({ tasks, rows: 20 });
    for (let i = 0; i < 39; i += 1) await t.press('j');
    expect(cursor(t)).toContain('card39');
    expect(t.text()).toHaveLength(20);
    for (let i = 0; i < 39; i += 1) await t.press('k');
    expect(cursor(t)).toContain('card00');
  });
});

describe('Board layout', () => {
  const exact = (t: T, w: number, h: number) => {
    expect(t.text()).toHaveLength(h);
    for (const line of t.text()) expect(visibleWidth(line)).toBe(w);
  };

  it('at 140 the board spans outline and detail and the sidebar stays', async () => {
    const t = await open({ width: 140, rows: 36 });
    exact(t, 140, 36);
    expect(t.text()[0]).toMatch(/^╭─ Views ─+╮╭─ Board ─+╮$/);
    expect(t.lastFrame()).not.toContain('Details');
    expect(t.lastFrame()).toMatch(/To do \(2\)\s+Doing \(0\)\s+Done ✓ \(0\)/);
  });

  it('at 100 the board takes the whole width', async () => {
    const t = await open();
    exact(t, 100, 30);
    expect(t.text()[0]).toMatch(/^╭─ Board ─+╮$/);
  });

  it('Enter opens card details over the board and Esc closes them with the cursor kept', async () => {
    const t = await open({ width: 140, rows: 36 });
    await t.press('j', KEY.enter);
    exact(t, 140, 36);
    // The details cover the board's right side, its border included.
    expect(t.text()[0]).toMatch(/^╭─ Views ─+╮╭─ Board ─+╭─ Details ─+╮$/);
    expect(t.lastFrame()).toMatch(/Title\s+beta/);
    expect(t.lastFrame()).toContain('To do (2)');
    await t.press(KEY.escape);
    expect(t.text()[0]).toMatch(/^╭─ Views ─+╮╭─ Board ─+╮$/);
    expect(t.lastFrame()).toMatch(/▸ beta/);
    expect(t.lastFrame()).not.toMatch(/▸ alpha/);
  });

  it('at 100, the card details are boxed over the board too', async () => {
    const t = await open();
    await t.press(KEY.enter);
    exact(t, 100, 30);
    expect(t.text()[0]).toMatch(/^╭─ Board ─+╭─ Details ─+╮$/);
    await t.press(KEY.escape);
    expect(t.text()[0]).toMatch(/^╭─ Board ─+╮$/);
  });

  it('at 80 one column shows and → shows the next status', async () => {
    const t = await open({
      width: 80,
      rows: 24,
      tasks: [task('alpha', 'todo', 'a0'), task('gamma', 'doing', 'a0')],
    });
    exact(t, 80, 24);
    expect(t.text()[0]).toMatch(/^╭─ Board ─+╮$/);
    expect(t.lastFrame()).toContain('TO DO (1/3)');
    expect(t.lastFrame()).toContain('alpha');
    expect(t.lastFrame()).not.toContain('gamma');
    await t.press(KEY.right);
    expect(t.lastFrame()).toContain('DOING (2/3)');
    expect(cursor(t)).toContain('gamma');
    expect(t.lastFrame()).not.toContain('alpha');
    await t.press('H');
    expect(row(t, 'gamma')?.statusId).toBe('todo');
  });

  it('at 80, Enter shows the card details full screen', async () => {
    const t = await open({ width: 80, rows: 24 });
    await t.press(KEY.enter);
    expect(t.text()[0]).toMatch(/^╭─ Details ─+╮$/);
    await t.press(KEY.escape);
    expect(t.lastFrame()).toContain('TO DO (1/3)');
  });

  it('draws no colour under NO_COLOR, the details overlay included', async () => {
    vi.stubEnv('NO_COLOR', '1');
    const t = await open({ width: 140, rows: 36 });
    await t.press(KEY.enter);
    expect(t.lines().join('')).not.toContain(`${ESC}[3`);
    expect(t.text()[0]).toMatch(/╔═ Details ═+╗$/);
  });
});
