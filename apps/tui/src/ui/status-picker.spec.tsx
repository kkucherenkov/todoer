import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, KEY, renderTui } from '../test-kit.js';
import { StatusPicker } from './status-picker.js';

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
    const t = await renderTui(
      <StatusPicker taskId="t1" current="s1" view="all" onDone={onDone} />,
      {
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
      },
    );
    cleanup = t.cleanup;
    expect(t.lastFrame()).toContain('› To do');
    expect(t.lastFrame()).toContain('Done ✓');
    await t.press('j', KEY.enter);
    expect(onDone).toHaveBeenCalled();
    expect(t.store.rows('task').find((r) => r.id === 't1')?.statusId).toBe(
      's2',
    );
  });
});
