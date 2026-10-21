import { localDate, type Catalog } from '@todoer/client-core';
import { describe, expect, it } from 'vitest';
import { clockEngine, row } from '../db/clockEngine.testing';
import { isBuiltIn, navEntries, navPath, routeKey, shownCount } from './nav';

const catalog = (nav: Catalog['nav'], projects: Catalog['projects'] = []) =>
  ({ views: [], statuses: [], tags: [], projects, nav }) satisfies Catalog;

describe('navigation entries', () => {
  it('none before the first catalog', () => {
    expect(navEntries(undefined)).toEqual([]);
  });

  it('every entry of catalog.nav, in its order, with its count, path and project name', () => {
    expect(
      navEntries(
        catalog(
          [
            { key: 'all', count: 4 },
            { key: 'today', count: 3 },
            { key: 'upcoming', count: 1 },
            { key: 'project:p1', count: 2 },
          ],
          [{ id: 'p1', name: 'Home' }],
        ),
      ),
    ).toEqual([
      { key: 'all', count: 4, path: '/', name: null },
      { key: 'today', count: 3, path: '/today', name: null },
      { key: 'upcoming', count: 1, path: '/upcoming', name: null },
      { key: 'project:p1', count: 2, path: '/projects/p1', name: 'Home' },
    ]);
  });

  it('a route names the key its page watches, and back', () => {
    const cases = [
      ['/', undefined, 'all'],
      ['/today', undefined, 'today'],
      ['/upcoming', undefined, 'upcoming'],
      ['/projects/p1', 'p1', 'project:p1'],
      ['/views/v1', 'v1', 'v1'],
    ] as const;
    for (const [path, id, key] of cases) {
      expect(routeKey(path, id)).toBe(key);
      expect(navPath(key)).toBe(path);
    }
  });
});

describe('the count a destination shows', () => {
  const nav = catalog([
    { key: 'all', count: 1 },
    { key: 'today', count: 2 },
  ]);
  const items = [{ closed: false }, { closed: true }, { closed: true }];

  it('a navigation key shows its catalog.nav count, whatever the layout lists', () => {
    expect(shownCount('today', nav, items)).toBe(2);
  });

  it('a saved view counts its open items, not the closed cards a board or calendar adds', () => {
    expect(shownCount('v1', nav, items)).toBe(1);
  });

  it('nothing published yet: zero', () => {
    expect(shownCount('today', undefined, undefined)).toBe(0);
  });

  it('only the built-in keys are labelled by the screen', () => {
    expect(
      ['all', 'today', 'upcoming', 'project:p', 'v1'].map(isBuiltIn),
    ).toEqual([true, true, true, false, false]);
  });
});

describe('navigation counts across midnight', () => {
  it('the next tick after local midnight moves a task due tomorrow into Today, no reload', async () => {
    // A fake clock: 23:59 local, then 00:01 the next day.
    const tomorrow = localDate(new Date(2026, 9, 22, 12));
    const { engine, clock, latest } = await clockEngine(
      [
        row('status', 's', { name: 'To do', rank: 'a0', completing: false }),
        row('task', 't', {
          title: 'Pay rent',
          priority: 4,
          rank: 'a0',
          dueOn: tomorrow,
        }),
      ],
      new Date(2026, 9, 21, 23, 59),
    );
    const count = (key: string) =>
      navEntries(latest.catalog).find((e) => e.key === key)?.count;
    expect(count('today')).toBe(0);
    expect(count('upcoming')).toBe(1);

    clock.now = new Date(2026, 9, 22, 0, 1);
    await engine.handle({ kind: 'sync', reason: 'tick' });
    expect(count('today')).toBe(1);
    expect(count('upcoming')).toBe(0);
  });
});
