import { describe, expect, it, vi } from 'vitest';
import { createTopics } from './topics.js';

describe('createTopics', () => {
  it('keeps the last value per topic and tells subscribers', () => {
    const topics = createTopics();
    const seen = vi.fn();
    const off = topics.subscribe(seen);
    topics.publish('summary', { tasks: 1 });
    topics.publish('summary', { tasks: 2 });
    expect(topics.get('summary')).toEqual({ tasks: 2 });
    expect(topics.get('catalog')).toBeUndefined();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    topics.publish('summary', { tasks: 3 });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('keeps one view per key, and one task per id', () => {
    const topics = createTopics();
    const view = (key: string) => ({
      key,
      layout: 'list',
      sort: 'manual',
      problem: null,
      today: '2026-10-03',
      span: null,
      items: [],
      placements: [],
    });
    topics.publish('view', view('a'));
    topics.publish('view', view('b'));
    expect(topics.view('a')?.key).toBe('a');
    expect(topics.view('b')?.key).toBe('b');
    topics.publish('task', { id: 't1', task: null });
    expect(topics.task('t1')).toEqual({ id: 't1', task: null });
  });
});
