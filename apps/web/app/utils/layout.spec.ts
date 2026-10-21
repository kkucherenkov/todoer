import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import {
  layoutQuery,
  nextLayout,
  resolveLayout,
  savedLayoutOf,
  viewQuery,
  watchArgs,
  watchView,
} from './layout';

describe('transient layout routes', () => {
  it('uses the saved layout when the override is missing', () => {
    expect(resolveLayout(undefined, 'list')).toEqual({
      layout: 'list',
      normalize: false,
      override: undefined,
    });
  });

  it('accepts List and Kanban without changing the saved layout', () => {
    expect(resolveLayout('kanban', 'list')).toEqual({
      layout: 'kanban',
      normalize: false,
      override: 'kanban',
    });
    expect(resolveLayout('list', 'kanban')).toEqual({
      layout: 'list',
      normalize: false,
      override: 'list',
    });
  });

  it('accepts every layout on every saved layout', () => {
    for (const saved of ['list', 'kanban', 'calendar'] as const) {
      for (const query of ['list', 'kanban', 'calendar'] as const) {
        if (query === saved) continue;
        expect(resolveLayout(query, saved)).toEqual({
          layout: query,
          normalize: false,
          override: query,
        });
      }
    }
  });

  it('normalizes invalid, repeated and redundant overrides', () => {
    for (const query of ['tiles', ['list', 'kanban'], null, 'list']) {
      expect(resolveLayout(query, 'list')).toMatchObject({
        layout: 'list',
        normalize: true,
        override: undefined,
      });
    }
    expect(resolveLayout('calendar', 'calendar')).toMatchObject({
      layout: 'calendar',
      normalize: true,
      override: undefined,
    });
    expect(resolveLayout(undefined, 'calendar')).toEqual({
      layout: 'calendar',
      normalize: false,
      override: undefined,
    });
  });

  it("reads a key's saved layout from the catalog; anything else is list", () => {
    const views = [
      { id: 'v1', layout: 'calendar' },
      { id: 'v2', layout: 'tiles' },
    ];
    expect(savedLayoutOf('v1', views)).toBe('calendar');
    expect(savedLayoutOf('v2', views)).toBe('list');
    expect(savedLayoutOf('all', views)).toBe('list');
    expect(savedLayoutOf('v1', undefined)).toBe('list');
  });

  it('preserves every other query while switching or changing view', () => {
    const query = {
      layout: 'list',
      task: 't1',
      mode: 'month',
      at: '2026-10-01',
      custom: 'kept',
    };
    expect(layoutQuery(query, 'kanban', 'kanban')).toEqual({
      layout: undefined,
      task: 't1',
      mode: 'month',
      at: '2026-10-01',
      custom: 'kept',
    });
    expect(viewQuery(query)).toEqual({ ...query, layout: undefined });
  });
});

describe('mode-group roving focus', () => {
  it('wraps arrows over all three modes and supports Home and End', () => {
    expect(nextLayout('list', 'ArrowRight')).toBe('kanban');
    expect(nextLayout('kanban', 'ArrowRight')).toBe('calendar');
    expect(nextLayout('calendar', 'ArrowRight')).toBe('list');
    expect(nextLayout('list', 'ArrowLeft')).toBe('calendar');
    expect(nextLayout('kanban', 'Home')).toBe('list');
    expect(nextLayout('list', 'End')).toBe('calendar');
  });
});

describe('what a tab sends in watch', () => {
  const TODAY = '2026-10-21';
  const WEEK = { from: '2026-10-19', to: '2026-10-25' };

  it('sends no override when the URL has none', () => {
    expect(watchArgs({ task: 't1' }, 'kanban', TODAY)).toEqual({
      task: 't1',
      span: null,
      layout: null,
    });
    expect(watchArgs({}, 'calendar', TODAY)).toEqual({
      task: null,
      span: WEEK,
      layout: null,
    });
  });

  it('sends Calendar with a span on a saved list', () => {
    expect(watchArgs({ layout: 'calendar' }, 'list', TODAY)).toEqual({
      task: null,
      span: WEEK,
      layout: 'calendar',
    });
    // No date yet: the span follows once the worker's today arrives.
    expect(watchArgs({ layout: 'calendar' }, 'list', undefined)).toEqual({
      task: null,
      span: null,
      layout: 'calendar',
    });
  });

  it('sends List without a span on a saved calendar', () => {
    const query = { layout: 'list', mode: 'month', at: '2026-10-01' };
    expect(watchArgs(query, 'calendar', TODAY)).toEqual({
      task: null,
      span: null,
      layout: 'list',
    });
  });

  it('sends no override for an invalid or redundant one', () => {
    for (const layout of ['tiles', 'list']) {
      expect(watchArgs({ layout }, 'list', TODAY).layout).toBeNull();
    }
  });
});

describe('watchView', () => {
  const setup = () => {
    const sent: unknown[][] = [];
    const key = ref('v1');
    const views = shallowRef([{ id: 'v1', layout: 'list' }]);
    const query = shallowRef<Record<string, unknown>>({});
    const today = ref<string>();
    effectScope().run(() =>
      watchView(
        (...args) => sent.push(args),
        () => key.value,
        () => views.value,
        () => query.value,
        () => today.value,
      ),
    );
    return { sent, key, views, query, today };
  };

  it('sends nothing for a catalog publish that keeps the saved layout', async () => {
    const { sent, views } = setup();
    expect(sent).toEqual([['v1', null, null, null]]);
    views.value = [
      { id: 'v1', layout: 'list' },
      { id: 'v2', layout: 'kanban' },
    ];
    await nextTick();
    expect(sent).toHaveLength(1);
  });

  it('rewatches when the saved layout, the key or the override changes', async () => {
    const { sent, key, views, query } = setup();
    views.value = [{ id: 'v1', layout: 'kanban' }];
    await nextTick();
    // ?layout=list is an override only once the saved layout is not list.
    query.value = { layout: 'list' };
    await nextTick();
    key.value = 'v2';
    await nextTick();
    expect(sent).toEqual([
      ['v1', null, null, null],
      ['v1', null, null, null],
      ['v1', null, null, 'list'],
      // Not in the catalog: saved as list, so ?layout=list is no override.
      ['v2', null, null, null],
    ]);
  });

  it('rewatches with a span once a calendar learns the date', async () => {
    const { sent, views, today } = setup();
    views.value = [{ id: 'v1', layout: 'calendar' }];
    await nextTick();
    today.value = '2026-10-21';
    await nextTick();
    expect(sent).toHaveLength(3);
    expect(sent[2]![2]).not.toBeNull();
  });
});
