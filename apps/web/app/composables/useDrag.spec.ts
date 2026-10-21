import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useDrag } from './useDrag';

/** Rows stacked 10 px high from y = 0, as `[data-task-id]` elements. */
const container = (...ids: string[]) =>
  ref({
    querySelectorAll: () =>
      ids.map((id, i) => ({
        dataset: { taskId: id },
        getBoundingClientRect: () => ({ top: i * 10, height: 10 }),
      })),
    contains: () => true,
  } as unknown as HTMLElement);

const event = (clientY: number) => {
  const e = {
    clientY,
    prevented: false,
    preventDefault: () => (e.prevented = true),
    dataTransfer: { setData: () => {}, effectAllowed: '' },
  };
  return e as unknown as DragEvent & { prevented: boolean };
};

describe('useDrag', () => {
  it('draws no line and offers no drop where `accepts` refuses', () => {
    const asked: [string, string | null][] = [];
    const drag = useDrag(
      container('a', 'b', 'c'),
      () => {},
      () => true,
      (id, after) => {
        asked.push([id, after]);
        return after !== 'a';
      },
    );
    drag.rowEvents('c').onDragstart(event(25));

    const refused = event(7); // below a's midpoint: after a
    drag.containerEvents.onDragover(refused);
    expect(refused.prevented).toBe(false);
    expect(drag.line.value).toBeNull();

    const accepted = event(2); // above a: first
    drag.containerEvents.onDragover(accepted);
    expect(accepted.prevented).toBe(true);
    expect(drag.line.value).toBe('a');
    expect(asked).toEqual([
      ['c', 'a'],
      ['c', null],
    ]);
  });
});
