import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY, fakeServer, renderApp } from './test-kit.js';
import { Root } from './root.js';

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

const status = {
  table: 'status',
  id: 's1',
  name: 'To do',
  rank: 'a0',
  completing: false,
  version: 1,
};
const view = {
  table: 'view',
  id: 'v1',
  name: 'Mine',
  layout: 'list',
  sort: 'manual',
  filter: { and: [] },
  rank: 'a0',
  version: 1,
};
const ids: Record<string, string> = {};
const id = (title: string) =>
  (ids[title] ??= `00000000-0000-7000-9000-${Object.keys(ids)
    .length.toString(16)
    .padStart(12, '0')}`);
const task = (title: string, rank = 'a0', fields = {}) => ({
  table: 'task',
  id: id(title),
  title,
  rank,
  priority: 4,
  version: 1,
  ...fields,
});

async function mount(
  rows: Record<string, unknown>[] = [],
  { width = 140, height = 36 } = {},
) {
  let root!: Root;
  const quit = vi.fn();
  const t = await renderApp({
    width,
    rows: height,
    server: fakeServer([status, ...rows]),
    app: (tui, size) => (root = new Root({ tui, ...size, quit })),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.settle();
  const text = () => t.lines().map(plain);
  const frame = () => text().join('\n');
  const handle = vi.spyOn(t.engine, 'handle');
  const watched = () =>
    handle.mock.calls
      .map(([c]) => c)
      .filter((c) => c.kind === 'watch')
      .map((c) => (c.kind === 'watch' ? c.view : ''));
  return { ...t, root, quit, text, frame, handle, watched };
}

const cursorLine = (lines: string[]) =>
  lines.find((l) => l.includes('▸ ○')) ?? '';

describe('Root', () => {
  it('lists views and the open tasks', async () => {
    const t = await mount([view, task('milk')]);
    const frame = t.frame();
    expect(frame).toContain('All open');
    expect(frame).toContain('Mine');
    expect(frame).toContain('milk');
  });

  it('fills exactly the rows, the two status lines last', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      task(`t${String(i)}`, `a${String(i).padStart(2, '0')}`),
    );
    const t = await mount(many, { width: 140, height: 24 });
    const lines = t.text();
    expect(lines).toHaveLength(24);
    for (const line of lines) expect(visibleWidth(line)).toBe(140);
    expect(lines[22]).toMatch(/^NORMAL · synced/);
    expect(lines[23]).toContain('q quit');
    // The outline scrolls instead of pushing the status lines off.
    await t.press(...Array<string>(30).fill('j'));
    expect(t.text()[22]).toMatch(/^NORMAL/);
    expect(cursorLine(t.text())).toContain('t30');
  });

  it('adds with o, completes with x, deletes with dd y', async () => {
    const t = await mount();
    await t.press('o', 'bread', KEY.enter);
    expect(t.frame()).toContain('bread');
    await t.press('x');
    expect(t.frame()).not.toContain('bread');
    await t.press('o', 'jam', KEY.enter, 'd', 'd', 'y');
    expect(t.frame()).not.toContain('jam');
  });

  it('switches views with ] and [', async () => {
    const t = await mount([view, task('milk')]);
    await t.press(']');
    expect(t.watched().at(-1)).toBe('today');
    expect(t.root.current).toBe('today');
    await t.press('[', '[');
    expect(t.watched().at(-1)).toBe('v1');
    await t.press(']');
    expect(t.watched().at(-1)).toBe('all');
  });

  it('edits a line in place with Enter', async () => {
    const t = await mount();
    await t.press('o', 'bread', KEY.enter, KEY.enter);
    // The editor opens on "bread" with the cursor at its end.
    await t.press(' @shop', KEY.enter);
    expect(t.frame()).toContain('bread');
    expect(t.topics.view('all')?.items[0]?.tags).toEqual(['@shop']);
    expect(t.status.message).toBeNull();
  });

  it('v opens the view picker', async () => {
    const t = await mount([view, task('milk')]);
    await t.press('v');
    expect(t.frame()).toContain('View');
    expect(t.frame()).toContain('› All open');
    // All open, Today, Upcoming, Mine.
    await t.press('j', 'j', 'j', KEY.enter);
    expect(t.root.current).toBe('v1');
    expect(t.watched().at(-1)).toBe('v1');
    expect(t.frame()).not.toContain('› All open');
  });

  it('? shows the help, with > and < for re-parenting', async () => {
    const t = await mount([task('milk')]);
    await t.press('?');
    expect(t.frame()).toMatch(/> <\s+re-parent/);
    expect(t.frame()).toMatch(/e\s+details/);
    expect(t.frame()).not.toContain('S-Tab');
    expect(t.frame()).not.toMatch(/Ctrl/);
    // Any key closes it and does nothing else.
    await t.press('x');
    expect(t.frame()).not.toContain('re-parent');
    expect(t.topics.view('all')?.items.map((i) => i.title)).toEqual(['milk']);
  });

  it('S opens the statuses screen', async () => {
    const t = await mount([task('milk')]);
    await t.press('S');
    expect(t.frame()).toContain('Statuses');
    expect(t.frame()).toMatch(/To do \(\d+\)/);
    await t.press(KEY.escape);
    expect(t.frame()).not.toContain('To do (');
    expect(t.frame()).toContain('milk');
  });

  it('syncs on r: offline shows with the queued count', async () => {
    const t = await mount();
    t.server.state.offline = true;
    await t.press('o', 'bread', KEY.enter);
    expect(t.frame()).toContain('bread');
    await t.press('r');
    expect(t.frame()).toMatch(/offline · 1 queued/);
  });

  it('points at todoer login when signed out, and q quits', async () => {
    const t = await mount();
    t.topics.publish('session', { state: 'signed-out', reason: null });
    await t.settle();
    expect(t.frame()).toMatch(/Run `todoer login`/);
    await t.press('q');
    expect(t.quit).toHaveBeenCalled();
  });

  for (const width of [60, 61, 62]) {
    it(`signed out at ${String(width)} columns, each line is exactly the width`, async () => {
      const t = await mount([], { width, height: 24 });
      t.topics.publish('session', { state: 'signed-out', reason: null });
      await t.settle();
      const [first, second] = t.text();
      expect(visibleWidth(first ?? '')).toBe(width);
      expect(first).toMatch(/…$/);
      expect(visibleWidth(second ?? '')).toBe(width);
    });
  }

  it('the hints and the help name what Enter does at the width', async () => {
    const t = await mount([task('milk')]);
    expect(t.text().at(-1)).toContain('Enter i edit');
    await t.press('?');
    expect(t.frame()).toMatch(/Enter i edit the line/);
    await t.press('x');
    t.resize(80, 24);
    expect(t.text().at(-1)).toContain('Enter details · i edit');
    await t.press('?');
    expect(t.frame()).not.toMatch(/Enter i edit/);
    expect(t.frame()).toMatch(/\bi\s+edit the line/);
    expect(t.frame()).toMatch(/Enter\s+details/);
  });

  it('the board’s add shows saving… while it waits, as the outline does', async () => {
    const board = { ...view, layout: 'kanban' };
    const t = await mount([board, task('milk', 'a0', { statusId: 's1' })]);
    await t.press('[', 'n', 'eggs');
    t.server.state.hold = true;
    t.input(KEY.enter);
    await t.server.until(1);
    expect(t.text().at(-1)).toMatch(/^saving…/);
    expect(t.text().at(-2)).toMatch(/^NORMAL/);
    t.server.state.hold = false;
    t.server.held.forEach((release) => release());
    await t.settle();
    expect(t.frame()).toContain('eggs');
  });

  it('leaves global keys to a line being typed', async () => {
    const t = await mount([view]);
    // q would quit, ] switch views, ? open the help.
    await t.press('o', 'q', ']', '?');
    expect(t.text().at(-2)).toMatch(/^INSERT/);
    await t.press(KEY.enter);
    expect(t.frame()).toContain('q]?');
    expect(t.quit).not.toHaveBeenCalled();
    expect(t.root.current).toBe('all');
    expect(t.text().at(-2)).toMatch(/^NORMAL/);
  });

  it('quits on q, and on Ctrl+C while a line is typed', async () => {
    const t = await mount();
    await t.press('q');
    expect(t.quit).toHaveBeenCalledTimes(1);
    await t.press('o', '\u0003');
    expect(t.quit).toHaveBeenCalledTimes(2);
  });

  it('Enter on a tag row watches tag:<id>', async () => {
    const t = await mount();
    await t.press('o', 'milk #home @shop', KEY.enter);
    const tag = t.topics.get('catalog')?.tags[0]?.id;
    expect(tag).toBeDefined();
    // outline → detail → sidebar; All open, Today, Upcoming, home, @shop.
    await t.press(KEY.tab, KEY.tab, 'j', 'j', 'j', 'j', KEY.enter);
    expect(t.handle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'watch', view: `tag:${String(tag)}` }),
      'tui',
    );
    expect(t.root.current).toBe(`tag:${String(tag)}`);
    expect(t.frame()).toContain('milk');
  });

  it('asks for a frame on a publish and on a message', async () => {
    const redraw = vi.fn();
    const t = await renderApp({
      app: (tui, size) =>
        new Root({ tui, ...size, quit: () => undefined, redraw }),
    });
    cleanup = t.cleanup;
    redraw.mockClear();
    t.status.say({ tone: 'info', text: 'hi' });
    expect(redraw).toHaveBeenCalledTimes(1);
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    expect(redraw.mock.calls.length).toBeGreaterThan(1);
  });

  it('takes the focus flag pi-tui sets on its focused component', async () => {
    const t = await mount();
    expect(() => Object.assign(t.root, { focused: true })).not.toThrow();
  });

  it('Tab cycles sidebar → outline → detail at 140', async () => {
    const t = await mount([task('milk')]);
    expect(t.root.focusAt).toBe('outline');
    await t.press(KEY.tab);
    expect(t.root.focusAt).toBe('detail');
    await t.press(KEY.tab);
    expect(t.root.focusAt).toBe('sidebar');
    await t.press(KEY.tab);
    expect(t.root.focusAt).toBe('outline');
  });

  it('dims the cursor of a pane without the focus', async () => {
    const t = await mount([task('milk')]);
    const sidebarCursor = () =>
      t.lines().find((l) => plain(l).startsWith('│▸ All open')) ?? '';
    expect(sidebarCursor()).toContain(`${ESC}[2m▸`);
    await t.press(KEY.tab, KEY.tab);
    expect(sidebarCursor()).not.toContain(`${ESC}[2m▸`);
  });

  it('shows the selected task in the detail column', async () => {
    const t = await mount([
      task('milk', 'a0', { dueOn: '2026-10-09' }),
      task('bread', 'a1'),
    ]);
    expect(t.frame()).toMatch(/Due\s+2026-10-09/);
    await t.press('j');
    expect(t.frame()).not.toMatch(/Due\s+2026-10-09/);
  });

  it('at 100 columns, focusing the sidebar draws it over the outline; Esc returns', async () => {
    const t = await mount([task('milk')], { width: 100 });
    expect(t.frame()).not.toContain('VIEWS');
    await t.press(KEY.tab, KEY.tab);
    expect(t.root.focusAt).toBe('sidebar');
    expect(t.frame()).toContain('VIEWS');
    expect(t.frame()).toContain('Due');
    await t.press(KEY.escape);
    expect(t.root.focusAt).toBe('outline');
    expect(t.frame()).not.toContain('VIEWS');
  });

  it('at 80 columns, Enter shows the details full screen; Esc returns to the same task', async () => {
    const t = await mount([task('milk'), task('bread', 'a1')], { width: 80 });
    expect(t.frame()).not.toContain('Priority');
    await t.press('j', KEY.enter);
    expect(t.frame()).toContain('Priority');
    expect(t.frame()).not.toContain('milk');
    expect(
      t
        .text()
        .at(-1)
        ?.match(/Esc q back/g),
    ).toHaveLength(1);
    await t.press(KEY.escape);
    expect(t.frame()).not.toContain('Priority');
    expect(cursorLine(t.text())).toContain('bread');
  });

  it('at 100 columns, picking a row from the sidebar overlay closes it', async () => {
    const t = await mount([task('milk')], { width: 100 });
    await t.press(KEY.tab, KEY.tab, 'j', KEY.enter);
    expect(t.root.current).toBe('today');
    expect(t.root.focusAt).toBe('outline');
    expect(t.frame()).not.toContain('VIEWS');
  });

  it('at 140, a focused sidebar is its own column, not an overlay', async () => {
    const t = await mount([task('milk')]);
    await t.press(KEY.tab, KEY.tab);
    expect(t.root.focusAt).toBe('sidebar');
    // Three whole boxes, none cut by an overlay.
    expect(t.text()[0]).toMatch(/^╭─ Views ─+╮╭─ Tasks ─+╮╭─ Details ─+╮$/);
    expect(t.frame()).not.toContain('Esc back');
  });

  it('falls back to All open when the watched view is deleted', async () => {
    const t = await mount([view, task('milk')]);
    await t.press('[');
    expect(t.root.current).toBe('v1');
    await t.engine.handle(
      { kind: 'deleteView', opId: t.newId(), id: 'v1' },
      'tui',
    );
    await t.settle();
    expect(t.root.current).toBe('all');
    expect(t.watched().at(-1)).toBe('all');
  });

  it('at 80, a view deleted under an open editor keeps it and its focus', async () => {
    const t = await mount([view, task('milk')], { width: 80 });
    await t.press('[', KEY.enter, KEY.enter);
    expect(t.text().at(-2)).toMatch(/^INSERT/);
    await t.engine.handle(
      { kind: 'deleteView', opId: t.newId(), id: 'v1' },
      'tui',
    );
    await t.settle();
    expect(t.root.current).toBe('all');
    expect(t.root.focusAt).toBe('detail');
    expect(t.text().at(-2)).toMatch(/^INSERT/);
    await t.press('X', KEY.enter);
    expect(t.store.rows('task')[0]?.title).toBe('milkX');
  });

  it('says why a view cannot be shown', async () => {
    const t = await mount([{ ...view, filter: { bogus: true } }, task('milk')]);
    await t.press('[');
    expect(t.root.current).toBe('v1');
    expect(t.topics.view('v1')?.problem).not.toBeNull();
    expect(t.frame()).toMatch(/this view cannot be shown: \S/);
  });

  it('m opens the status picker on an outline row, and e focuses the detail pane', async () => {
    const t = await mount([task('milk')]);
    await t.press('m');
    expect(t.frame()).toContain('› To do');
    await t.press(KEY.escape);
    expect(t.frame()).not.toContain('› To do');
    await t.press('e');
    expect(t.root.focusAt).toBe('detail');
  });

  it('while too small, keys do not reach an open input', async () => {
    const t = await mount([task('milk')]);
    await t.press('o', 'bread');
    t.resize(59, 30);
    await t.press('x', KEY.enter);
    expect(t.topics.view('all')?.items.map((i) => i.title)).toEqual(['milk']);
    expect(t.quit).not.toHaveBeenCalled();
    t.resize(140, 36);
    expect(t.text().at(-2)).toMatch(/^INSERT/);
    expect(t.frame()).toContain('new: bread');
    await t.press(KEY.enter);
    expect(t.frame()).toContain('bread');
    t.resize(59, 30);
    await t.press('q');
    expect(t.quit).toHaveBeenCalled();
  });

  it('n opens the add on its row in INSERT; a refused add shows its keys', async () => {
    const t = await mount([task('milk'), task('bread', 'a1')]);
    await t.press('n');
    expect(t.text().at(-2)).toMatch(/^INSERT/);
    t.server.state.refuse = () => 'title taken';
    await t.press('eggs', KEY.enter);
    expect(t.text().at(-2)).toMatch(/^NORMAL/);
    expect(t.text().at(-1)).toMatch(/^Enter edit · Esc discard/);
    await t.press('q', KEY.escape);
    expect(t.quit).not.toHaveBeenCalled();
    expect(t.frame()).not.toContain('eggs');
  });

  describe('/ filter', () => {
    const rows = () => [
      task('buy milk'),
      task('bread', 'a1'),
      task('milk shake', 'a2'),
    ];

    it('/ types the filter in the top status line and Enter keeps it', async () => {
      const t = await mount(rows());
      const counts = () =>
        t
          .text()
          .slice(1, 4)
          .map((l) => l.slice(0, 24));
      const before = counts();
      await t.press('/');
      expect(t.text().at(-2)).toMatch(/^INSERT · \//);
      await t.press('m', 'i', 'l', 'k');
      expect(t.text().at(-2)).toMatch(/^INSERT · \/milk/);
      expect(t.text()[0]).toMatch(/╭─ Tasks \/milk ─+╮/);
      expect(t.frame()).not.toContain('bread');
      expect(counts()).toEqual(before);
      await t.press(KEY.enter);
      expect(t.text().at(-2)).toMatch(/^NORMAL · synced/);
      expect(t.frame()).not.toContain('bread');
      // NORMAL keys act on the filtered rows.
      await t.press('j');
      expect(cursorLine(t.text())).toContain('milk shake');
      // Another view starts unfiltered.
      await t.press(']');
      expect(t.text()[0]).toMatch(/╭─ Tasks ─+╮/);
    });

    it('Esc in the input clears the filter', async () => {
      const t = await mount(rows());
      await t.press('/', 'b', 'r', KEY.escape);
      expect(t.text().at(-2)).toMatch(/^NORMAL/);
      expect(t.frame()).toContain('buy milk');
      expect(t.text()[0]).toMatch(/╭─ Tasks ─+╮/);
    });

    it('Esc clears a kept filter last, after an overlay', async () => {
      const t = await mount(rows(), { width: 100, height: 30 });
      await t.press('/', 'milk', KEY.enter, KEY.tab, KEY.tab);
      expect(t.root.focusAt).toBe('sidebar');
      await t.press(KEY.escape);
      expect(t.root.focusAt).toBe('outline');
      expect(t.frame()).not.toContain('bread');
      await t.press(KEY.escape);
      expect(t.frame()).toContain('bread');
    });

    it('a refused add takes Esc before the filter', async () => {
      const t = await mount(rows());
      await t.press('/', 'milk', KEY.enter);
      t.server.state.refuse = () => 'title taken';
      await t.press('n', 'milk tea', KEY.enter, KEY.escape);
      expect(t.frame()).not.toContain('milk tea');
      expect(t.frame()).not.toContain('bread');
    });
  });

  it('at 140, Esc in the detail pane gives the focus back to the outline', async () => {
    const t = await mount([task('milk')]);
    await t.press('e');
    expect(t.root.focusAt).toBe('detail');
    await t.press(KEY.escape);
    expect(t.root.focusAt).toBe('outline');
  });

  it('a kanban view draws the board, and Enter shows its card’s details', async () => {
    const board = { ...view, layout: 'kanban' };
    const t = await mount([
      { ...status, id: 's2', name: 'Doing', rank: 'a1' },
      board,
      task('milk', 'a0', { statusId: 's1', dueOn: '2026-10-08' }),
      task('bread', 'a0', { statusId: 's2', dueOn: '2026-10-09' }),
    ]);
    await t.press('[');
    expect(t.frame()).toMatch(/To do \(1\)\s+Doing \(1\)/);
    await t.press(KEY.enter);
    expect(t.frame()).toMatch(/Due\s+2026-10-08/);
    await t.press(KEY.escape, 'l', KEY.enter);
    expect(t.frame()).toMatch(/Due\s+2026-10-09/);
    await t.press(KEY.escape);
    expect(t.text().at(-1)).toContain('H/L move');
  });

  it('with NO_COLOR=1, no frame contains a colour', async () => {
    vi.stubEnv('NO_COLOR', '1');
    const t = await mount([
      task('urgent', 'a0', { priority: 0, dueOn: '2026-01-01' }),
    ]);
    t.status.say({ tone: 'error', text: 'refused' });
    const raw = () => t.lines().join('\n');
    expect(raw()).not.toContain(`${ESC}[3`);
    for (const key of [KEY.tab, KEY.tab, 'j', KEY.tab]) {
      await t.press(key);
      expect(raw()).not.toContain(`${ESC}[3`);
    }
  });

  describe('pane boxes', () => {
    const highlighted = (raw: string) =>
      new RegExp(
        `${ESC}\\[36m╭─ ${ESC}\\[0m${ESC}\\[1m${ESC}\\[36m(\\w+)`,
      ).exec(raw)?.[1];
    const exact = (
      t: Awaited<ReturnType<typeof mount>>,
      w: number,
      h: number,
    ) => {
      expect(t.text()).toHaveLength(h);
      for (const line of t.text()) expect(visibleWidth(line)).toBe(w);
    };

    it('at 140x36, draws Views, Tasks and Details in boxes; Tab moves the highlight', async () => {
      const t = await mount([task('milk')]);
      const top = () => t.text()[0] ?? '';
      expect(top()).toMatch(/^╭─ Views ─+╮╭─ Tasks ─+╮╭─ Details ─+╮$/);
      expect(t.text()[33]).toMatch(/^╰─+╯╰─+╯╰─+╯$/);
      exact(t, 140, 36);
      const raw0 = () => t.lines()[0] ?? '';
      expect(highlighted(raw0())).toBe('Tasks');
      await t.press(KEY.tab);
      expect(highlighted(raw0())).toBe('Details');
      await t.press(KEY.tab);
      expect(highlighted(raw0())).toBe('Views');
    });

    it('at 100x30, draws the sidebar overlay boxed over the tasks', async () => {
      const t = await mount([task('milk')], { width: 100, height: 30 });
      exact(t, 100, 30);
      expect(t.text()[0]).toMatch(/^╭─ Tasks ─+╮╭─ Details ─+╮$/);
      await t.press(KEY.tab, KEY.tab);
      exact(t, 100, 30);
      expect(t.text()[0]).toMatch(/^╭─ Views ─+╮/);
      expect(t.text()[27]).toMatch(/^╰─+╯/);
      expect(highlighted(t.lines()[0] ?? '')).toBe('Views');
    });

    it('at 80x24, boxes the full-screen details', async () => {
      const t = await mount([task('milk')], { width: 80, height: 24 });
      exact(t, 80, 24);
      expect(t.text()[0]).toMatch(/^╭─ Tasks ─+╮$/);
      await t.press(KEY.enter);
      exact(t, 80, 24);
      expect(t.text()[0]).toMatch(/^╭─ Details ─+╮$/);
      expect(t.text()[21]).toMatch(/^╰─+╯$/);
    });

    it('at the minimum, still shows a box with content', async () => {
      const t = await mount([task('milk')], { width: 60, height: 14 });
      exact(t, 60, 14);
      expect(t.frame()).toContain('milk');
      expect(t.text()[0]).toMatch(/^╭─ Tasks/);
    });

    it('with NO_COLOR=1, no colour code and every bold closed on its line', async () => {
      vi.stubEnv('NO_COLOR', '1');
      const t = await mount([task('milk')]);
      for (const line of t.lines()) {
        expect(line).not.toContain(`${ESC}[3`);
        const open = (line.match(new RegExp(`${ESC}\\[1m`, 'g')) ?? []).length;
        const shut = (line.match(new RegExp(`${ESC}\\[(22|0)m`, 'g')) ?? [])
          .length;
        expect(shut).toBeGreaterThanOrEqual(open);
        if (open > 0) {
          expect(line.lastIndexOf(`${ESC}[1m`)).toBeLessThan(
            Math.max(
              line.lastIndexOf(`${ESC}[22m`),
              line.lastIndexOf(`${ESC}[0m`),
            ),
          );
        }
      }
    });

    it('with NO_COLOR=1, the active pane has a double border', async () => {
      vi.stubEnv('NO_COLOR', '1');
      const t = await mount([task('milk')]);
      expect(t.text()[0]).toMatch(/^╭─ Views ─+╮╔═ Tasks ═+╗╭─ Details ─+╮$/);
    });
  });

  it('resize(59, 30) shows the too small line; resize(140, 36) restores', async () => {
    const t = await mount([task('milk')]);
    t.resize(59, 30);
    expect(t.frame()).toMatch(/too small/);
    expect(t.frame()).not.toContain('milk');
    t.resize(140, 36);
    expect(t.frame()).toContain('VIEWS');
    expect(t.frame()).toContain('milk');
  });
});
