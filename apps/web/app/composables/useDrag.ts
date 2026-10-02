import type { Ref } from 'vue';

export const DRAG_TYPE = 'application/x-todoer-task';
/** `line` when the insertion line sits below the last row. */
export const END = '';

/**
 * Drag a row to a gap of `container` (rows carry `data-task-id`). The gap is
 * the pointer's Y against each row's midpoint, the dragged row excluded;
 * `drop` gets the id of the row it now follows, null for first. Shared by the
 * list and, per column, the board.
 */
export function useDrag(
  container: Ref<HTMLElement | null>,
  drop: (taskId: string, after: string | null) => void,
  enabled: () => boolean = () => true,
) {
  /** The id of the row the insertion line is drawn above; null: no line. */
  const line = ref<string | null>(null);
  // dragover cannot read dataTransfer data, so the tab remembers its own.
  let dragging: string | null = null;

  const gap = (y: number) => {
    const rows = [
      ...(container.value?.querySelectorAll<HTMLElement>('[data-task-id]') ??
        []),
    ].filter((el) => el.dataset.taskId !== dragging);
    const i = rows.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    const next = i === -1 ? rows.length : i;
    return {
      after: next > 0 ? (rows[next - 1]!.dataset.taskId ?? null) : null,
      before: rows[next]?.dataset.taskId ?? END,
    };
  };

  const clear = () => {
    line.value = null;
    dragging = null;
  };

  return {
    line,
    rowEvents: (id: string) => ({
      draggable: enabled(),
      onDragstart: (e: DragEvent) => {
        dragging = id;
        e.dataTransfer?.setData(DRAG_TYPE, id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      },
      onDragend: clear,
    }),
    containerEvents: {
      onDragover: (e: DragEvent) => {
        if (!enabled() || dragging === null) return;
        e.preventDefault();
        line.value = gap(e.clientY).before;
      },
      onDragleave: (e: DragEvent) => {
        if (!container.value?.contains(e.relatedTarget as Node | null)) {
          line.value = null;
        }
      },
      onDrop: (e: DragEvent) => {
        const id = e.dataTransfer?.getData(DRAG_TYPE);
        if (!enabled() || !id || dragging === null) return;
        e.preventDefault();
        const { after } = gap(e.clientY);
        clear();
        drop(id, after);
      },
    },
  };
}
