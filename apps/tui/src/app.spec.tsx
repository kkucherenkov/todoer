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
const view = {
  table: 'view',
  id: 'v1',
  name: 'Mine',
  layout: 'list',
  sort: 'manual',
  filter: { all: [] },
  rank: 'a0',
  version: 1,
};
const task = (id: string, title: string, rank = 'a0') => ({
  table: 'task',
  id,
  title,
  rank,
  priority: 0,
  version: 1,
});

describe('App', () => {
  it('lists views and the open tasks', async () => {
    const t = await renderTui(<App />, {
      server: fakeServer([status, view, task('t1', 'milk')]),
    });
    cleanup = t.cleanup;
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    await t.settle();
    const frame = t.lastFrame() ?? '';
    expect(frame).toContain('All open');
    expect(frame).toContain('Mine');
    expect(frame).toContain('milk');
  });

  it('adds with o, completes with x, deletes with dd y', async () => {
    const t = await renderTui(<App />, { server: fakeServer([status]) });
    cleanup = t.cleanup;
    await t.press('o', 'bread', KEY.enter);
    expect(t.lastFrame()).toContain('bread');
    await t.press('x');
    expect(t.lastFrame()).not.toContain('bread');
    await t.press('o', 'jam', KEY.enter, 'd', 'd', 'y');
    expect(t.lastFrame()).not.toContain('jam');
  });

  it('switches views with ] and [', async () => {
    const t = await renderTui(<App />, {
      server: fakeServer([status, view, task('t1', 'milk')]),
    });
    cleanup = t.cleanup;
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    await t.press(']');
    expect(t.lastFrame()).toMatch(/Mine/);
    await t.press('[');
    expect(t.lastFrame()).toMatch(/All open/);
  });

  it('edits a line in place with Enter', async () => {
    const t = await renderTui(<App />, { server: fakeServer([status]) });
    cleanup = t.cleanup;
    await t.press('o', 'bread', KEY.enter, KEY.enter);
    // The editor opens on "bread"; move to its end and type.
    await t.press(' @shop', KEY.enter);
    expect(t.lastFrame()).toContain('bread');
    expect(t.topics.view('all')?.items[0]?.tags).toEqual(['@shop']);
    expect(t.status.message).toBeNull();
  });
  it('syncs on r: offline shows with the pending count', async () => {
    const server = fakeServer([status]);
    const t = await renderTui(<App />, { server });
    cleanup = t.cleanup;
    server.state.offline = true;
    await t.press('o', 'bread', KEY.enter);
    expect(t.lastFrame()).toContain('bread');
    await t.press('r');
    expect(t.lastFrame()).toMatch(/offline · 1 pending/);
  });

  it('points at todoer login when signed out', async () => {
    const t = await renderTui(<App />);
    cleanup = t.cleanup;
    t.topics.publish('session', { state: 'signed-out', reason: null });
    await t.settle();
    expect(t.lastFrame()).toMatch(/Run `todoer login`/);
  });
  it('leaves global keys to a line being typed', async () => {
    const t = await renderTui(<App />, {
      server: fakeServer([status, view]),
    });
    cleanup = t.cleanup;
    // q would quit, ] switch views, ? open the help.
    await t.press('o', 'q', ']', '?', KEY.enter);
    expect(t.lastFrame()).toContain('q]?');
    expect(t.lastFrame()).toMatch(/▸ All open/);
  });
});
