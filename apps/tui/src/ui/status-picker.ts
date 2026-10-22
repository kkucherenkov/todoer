import { ALL } from '@todoer/client-core';
import type { Tui } from '../tui.js';
import type { createWrite } from '../write.js';
import { Picker } from './picker.js';

/** Moves `taskId` to the picked status; closes either way. Moving into the
 *  completing status marks the task done (the engine's `move`). Null, said
 *  on the status line, when there are no statuses. */
export function statusPicker({
  topics,
  status,
  write,
  taskId,
  current,
  view,
  onDone,
}: Pick<Tui, 'topics' | 'status'> & {
  write: ReturnType<typeof createWrite>;
  taskId: string;
  current: string | null;
  /** The view the move happens in, or `ALL`. */
  view: string;
  onDone: () => void;
}): Picker | null {
  const statuses = topics.get('catalog')?.statuses ?? [];
  if (statuses.length === 0) {
    status.say({ tone: 'info', text: 'no statuses yet — S to add one' });
    return null;
  }
  return new Picker({
    title: 'Status',
    items: statuses.map((s) => ({
      id: s.id,
      label: s.completing ? `${s.name} ✓` : s.name,
    })),
    ...(current === null ? {} : { initial: current }),
    onCancel: onDone,
    onPick: (statusId) => {
      onDone();
      void write((newId) => ({
        kind: 'move',
        opId: newId(),
        taskId,
        view: view || ALL,
        statusId,
      }));
    },
  });
}
