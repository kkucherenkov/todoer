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
) => ({
  table: 'status',
  id,
  name,
  rank,
  completing,
  version: 1,
});

async function statuses() {
  const t = await renderTui(<App />, {
    server: fakeServer([
      status('todo', 'To do', 'a0'),
      status('doing', 'Doing', 'a1'),
      status('done', 'Done', 'a2', true),
      {
        table: 'task',
        id: 't1',
        title: 'milk',
        rank: 'a0',
        priority: 0,
        statusId: 'doing',
        version: 1,
      },
    ]),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.press('S');
  return t;
}
const live = (t: Awaited<ReturnType<typeof statuses>>) =>
  t.store
    .rows('status')
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => String(a.rank).localeCompare(String(b.rank)));
const names = (t: Awaited<ReturnType<typeof statuses>>) =>
  live(t).map((s) => s.name);
const backspaces = (n: number) => Array.from({ length: n }, () => '\u007f');

describe('StatusesScreen', () => {
  it('lists the statuses in rank order with counts and closes with Esc', async () => {
    const t = await statuses();
    const frame = t.lastFrame() ?? '';
    expect(frame.indexOf('To do')).toBeLessThan(frame.indexOf('Doing'));
    expect(frame).toContain('Doing (1)');
    expect(frame).toMatch(/Done ✓ \(0\)/);
    await t.press(KEY.escape);
    expect(t.lastFrame()).not.toContain('Doing (');
  });

  it('adds a status after the cursor', async () => {
    const t = await statuses();
    await t.press('a', 'Review', KEY.enter);
    expect(names(t)).toEqual(['To do', 'Review', 'Doing', 'Done']);
    expect(t.lastFrame()).not.toContain('new status:');
  });

  it('renames with Enter', async () => {
    const t = await statuses();
    await t.press('j', KEY.enter, ...backspaces(5), 'Working', KEY.enter);
    expect(names(t)).toEqual(['To do', 'Working', 'Done']);
    expect(t.lastFrame()).not.toContain('rename:');
  });

  it('keeps the input and its text open on a refused rename', async () => {
    const t = await statuses();
    await t.press('j', KEY.enter, ...backspaces(5), 'Done', KEY.enter);
    expect(names(t)).toEqual(['To do', 'Doing', 'Done']);
    expect(t.lastFrame()).toContain('rename: Done');
    expect(t.lastFrame()).toContain('already exists');
  });

  it('moves a status down with J and up with K, not past the ends', async () => {
    const t = await statuses();
    await t.press('J');
    expect(names(t)).toEqual(['Doing', 'To do', 'Done']);
    await t.press('K');
    expect(names(t)).toEqual(['To do', 'Doing', 'Done']);
    await t.press('K');
    expect(names(t)).toEqual(['To do', 'Doing', 'Done']);
  });

  it('marks completing with c', async () => {
    const t = await statuses();
    await t.press('j', 'c');
    const rows = live(t);
    expect(rows.find((s) => s.name === 'Doing')?.completing).toBe(true);
    expect(rows.find((s) => s.name === 'Done')?.completing).toBe(false);
  });

  it('deletes with dd y, naming the tasks that move; dd n keeps it', async () => {
    const t = await statuses();
    await t.press('j', 'd', 'd');
    expect(t.lastFrame()).toContain('its 1 task(s) move');
    await t.press('n');
    expect(names(t)).toHaveLength(3);
    await t.press('d', 'd', 'y');
    expect(names(t)).toEqual(['To do', 'Done']);
  });

  it('says why the completing status cannot be deleted', async () => {
    const t = await statuses();
    await t.press('j', 'j', 'd', 'd', 'y');
    expect(names(t)).toHaveLength(3);
    expect(t.lastFrame()).toContain('cannot be deleted');
  });
});
