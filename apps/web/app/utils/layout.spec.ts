import { describe, expect, it } from 'vitest';
import { layoutQuery, nextLayout, resolveLayout, viewQuery } from './layout';

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

  it('normalizes invalid, repeated, redundant and unsupported overrides', () => {
    for (const query of ['tiles', ['list', 'kanban'], null, 'calendar']) {
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
  });

  it('lets a saved Calendar switch among all three projections', () => {
    expect(resolveLayout('list', 'calendar').layout).toBe('list');
    expect(resolveLayout('kanban', 'calendar').layout).toBe('kanban');
    expect(resolveLayout(undefined, 'calendar').layout).toBe('calendar');
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
  it('wraps arrows and supports Home and End', () => {
    expect(nextLayout('list', 'ArrowLeft', 'calendar')).toBe('calendar');
    expect(nextLayout('calendar', 'ArrowRight', 'calendar')).toBe('list');
    expect(nextLayout('kanban', 'Home', 'calendar')).toBe('list');
    expect(nextLayout('list', 'End', 'calendar')).toBe('calendar');
  });

  it('skips Calendar until its saved projection is available', () => {
    expect(nextLayout('kanban', 'ArrowRight', 'list')).toBe('list');
    expect(nextLayout('list', 'ArrowLeft', 'list')).toBe('kanban');
    expect(nextLayout('list', 'End', 'list')).toBe('kanban');
  });
});
