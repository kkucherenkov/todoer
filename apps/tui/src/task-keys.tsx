import type { Key } from 'ink';
import { useRef, useState, type ReactNode } from 'react';
import type { Item } from '@todoer/client-core';
import { useTui } from './context.js';
import { lineChanges, lineOf } from './line.js';
import type { Screen } from './screens.js';
import { confirmKeys } from './ui/confirm.js';
import { LineInput } from './ui/line-input.js';
import { StatusPicker } from './ui/status-picker.js';
import { useWrite } from './use-write.js';

/**
 * The task keys every pane shares: `x`/Space done or undo, `s` skip, `dd`
 * then `y` delete, `e` details, `m` status, Enter/`i` edit the line in
 * place. A pane calls `handle` first in its own `useInput` and stops when it
 * returns true; it renders `overlay` (an editor or a picker) and gives its
 * own keys up while `busy`.
 */
export function useTaskKeys({
  current,
  viewKey,
  open,
}: {
  current: Item | undefined;
  viewKey: string;
  open: (screen: Screen) => void;
}): {
  handle: (input: string, key: Key) => boolean;
  overlay: ReactNode;
  busy: boolean;
} {
  const { status } = useTui();
  const write = useWrite();
  const [mode, setMode] = useState<'idle' | 'edit' | 'status' | 'delete'>(
    'idle',
  );
  // `dd`: the first `d` waits for a second; any other key forgets it.
  const pendingD = useRef(false);
  const idle = () => setMode('idle');

  const handle = (input: string, key: Key): boolean => {
    if (mode === 'delete') {
      idle();
      status.clear();
      if (confirmKeys(input) === 'yes' && current !== undefined) {
        void write((newId) => ({
          kind: 'deleteTask',
          opId: newId(),
          taskId: String(current.id),
        }));
      }
      return true;
    }
    if (mode !== 'idle' || current === undefined) return false;
    const taskId = String(current.id);
    if (input === 'd') {
      if (!pendingD.current) {
        pendingD.current = true;
        return true;
      }
      pendingD.current = false;
      setMode('delete');
      status.say({
        tone: 'info',
        text: `delete "${String(current.title)}"? y/n`,
      });
      return true;
    }
    pendingD.current = false;
    if (input === 'x' || input === ' ') {
      void write((newId) => ({
        kind: 'mark',
        opId: newId(),
        taskId,
        mark: current.closed ? 'undo' : 'done',
      }));
    } else if (input === 's') {
      void write((newId) => ({
        kind: 'mark',
        opId: newId(),
        taskId,
        mark: 'skip',
      }));
    } else if (input === 'e') {
      open({ kind: 'details', taskId });
    } else if (input === 'm') {
      setMode('status');
    } else if (input === 'i' || key.return) {
      setMode('edit');
    } else {
      return false;
    }
    return true;
  };

  const overlay =
    current === undefined ? null : mode === 'edit' ? (
      <LineInput
        label="edit:"
        initial={lineOf(current)}
        onCancel={idle}
        onSubmit={(line) => {
          const changes = lineChanges(current, line);
          if (Object.keys(changes).length === 0) return idle();
          // Open until the write is taken: a refusal keeps the text.
          void write((newId) => ({
            kind: 'edit',
            opId: newId(),
            taskId: String(current.id),
            changes,
          })).then((r) => r.ok && idle());
        }}
      />
    ) : mode === 'status' ? (
      <StatusPicker
        taskId={String(current.id)}
        current={current.column}
        view={viewKey}
        onDone={idle}
      />
    ) : null;

  return { handle, overlay, busy: mode === 'edit' || mode === 'status' };
}
