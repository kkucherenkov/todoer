import { useEffect } from 'react';
import { ALL } from '@todoer/client-core';
import { useTui } from '../context.js';
import { useTopic } from '../topics.js';
import { useWrite } from '../use-write.js';
import { Picker } from './picker.js';

/** Moves `taskId` to the picked status; closes either way. Moving into the
 *  completing status marks the task done (the engine's `move`). */
export function StatusPicker({
  taskId,
  current,
  view,
  onDone,
}: {
  taskId: string;
  current: string | null;
  /** The view the move happens in, or `ALL`. */
  view: string;
  onDone: () => void;
}) {
  const { topics, status } = useTui();
  const write = useWrite();
  const statuses = useTopic(topics, 'catalog')?.statuses ?? [];
  const none = statuses.length === 0;
  useEffect(() => {
    if (!none) return;
    status.say({ tone: 'info', text: 'no statuses yet — S to add one' });
    onDone();
  }, [none]);
  if (none) return null;
  return (
    <Picker
      title="Status"
      items={statuses.map((s) => ({
        id: s.id,
        label: s.completing ? `${s.name} ✓` : s.name,
      }))}
      {...(current === null ? {} : { initial: current })}
      onCancel={onDone}
      onPick={(statusId) => {
        onDone();
        void write((newId) => ({
          kind: 'move',
          opId: newId(),
          taskId,
          view: view || ALL,
          statusId,
        }));
      }}
    />
  );
}
