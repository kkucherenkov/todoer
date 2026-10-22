import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY, fakeServer, renderApp } from './pi/test-kit.js';
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
    app: (tui, size) => (root = new Root({ tui, rows: size.rows, quit })),
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

  it.todo('edits a line in place with Enter (Task 2.1)');
  it.todo('v opens the view picker (Task 1.6)');
  it.todo('? shows the help, with > and < for re-parenting (Task 1.6)');
  it.todo('S opens the statuses screen (Task 1.6)');

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
        new Root({ tui, rows: size.rows, quit: () => undefined, redraw }),
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
      t.lines().find((l) => plain(l).startsWith('▸ All open')) ?? '';
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
    await t.press(KEY.escape);
    expect(t.frame()).not.toContain('Priority');
    expect(cursorLine(t.text())).toContain('bread');
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
