import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, KEY, renderApp } from '../test-kit.js';
import { createWrite } from '../write.js';
import { statusPicker } from './status-picker.js';

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

describe('StatusPicker', () => {
  it('moves the task to the picked status and closes', async () => {
    const onDone = vi.fn();
    const t = await renderApp({
      server: fakeServer([
        status('s1', 'To do', 'a0'),
        status('s2', 'Done', 'a1', true),
        {
          table: 'task',
          id: 't1',
          title: 'milk',
          rank: 'a0',
          priority: 0,
          statusId: 's1',
          version: 1,
        },
      ]),
    });
    cleanup = t.cleanup;
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    await t.settle();
    const picker = statusPicker({
      ...t,
      write: createWrite(t),
      taskId: 't1',
      current: 's1',
      view: 'all',
      onDone,
    });
    const frame = () => picker?.render(40).join('\n') ?? '';
    expect(frame()).toContain('› To do');
    expect(frame()).toContain('Done ✓');
    picker?.handleInput('j');
    picker?.handleInput(KEY.enter);
    await t.settle();
    expect(onDone).toHaveBeenCalled();
    expect(t.store.rows('task').find((r) => r.id === 't1')?.statusId).toBe(
      's2',
    );
  });
});
