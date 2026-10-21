import { describe, expect, it } from 'vitest';
import {
  layoutQuery,
  nextLayout,
  resolveLayout,
  savedLayoutOf,
  viewQuery,
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
