import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import { useTui } from './context.js';
import { useTopic } from './topics.js';
import { confirmKeys } from './ui/confirm.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

type Editing =
  null | { kind: 'add' } | { kind: 'rename'; id: string; name: string };

/**
 * The statuses (the board's columns) in rank order: `a` add after the
 * cursor, Enter rename, `J`/`K` move, `c` completing, `dd` then `y` delete.
 * Deleting leaves the status's tasks without one, which shows them in the
 * first status (views Q8).
 */
function Statuses({ close }: { close: () => void }) {
  const { topics, status } = useTui();
  const write = useWrite();
  const list = useTopic(topics, 'catalog')?.statuses ?? [];
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState(false);
  // `dd`: the first `d` waits for a second; any other key forgets it.
  const pendingD = useRef(false);
  const k = Math.min(at, list.length - 1);
  const current = list[k];

  /** Moves `current` one place: after the status two above (or first), or
   *  after the next one. */
  const reorder = (step: -1 | 1) => {
    if (current === undefined) return;
    const target = k + step;
    if (target < 0 || target >= list.length) return;
    const after =
      step === -1 ? (list[k - 2]?.id ?? null) : (list[k + 1]?.id ?? null);
    void write((newId) => ({
      kind: 'saveStatus',
      opId: newId(),
      id: current.id,
      after,
    }));
    setAt(target);
  };

  useInput(
    (input, key) => {
      if (deleting) {
        setDeleting(false);
        status.clear();
        if (confirmKeys(input) === 'yes' && current !== undefined) {
          void write((newId) => ({
            kind: 'deleteStatus',
            opId: newId(),
            id: current.id,
          }));
        }
        return;
      }
      if (input === 'd') {
        if (!pendingD.current) {
          pendingD.current = true;
          return;
        }
        pendingD.current = false;
        if (current === undefined) return;
        setDeleting(true);
        status.say({
          tone: 'info',
          text: `delete "${current.name}"? its ${current.tasks} task(s) move to the first status · y/n`,
        });
        return;
      }
      pendingD.current = false;
      status.clear();
      if (key.escape || input === 'q') close();
      else if (input === 'j' || key.downArrow)
        setAt(Math.min(list.length - 1, k + 1));
      else if (input === 'k' || key.upArrow) setAt(Math.max(0, k - 1));
      else if (input === 'a') setEditing({ kind: 'add' });
      else if (current === undefined) return;
      else if (key.return)
        setEditing({ kind: 'rename', id: current.id, name: current.name });
      else if (input === 'J') reorder(1);
      else if (input === 'K') reorder(-1);
      else if (input === 'c') {
        void write((newId) => ({
          kind: 'setCompleting',
          opId: newId(),
          id: current.id,
        }));
      }
    },
    { isActive: editing === null },
  );

  return (
    <Box flexDirection="column">
      <Text bold>Statuses</Text>
      {list.length === 0 ? <Text dimColor>none yet · a to add</Text> : null}
      {list.map((s, i) => (
        <Text key={s.id} inverse={editing === null && i === k}>
          {s.name}
          {s.completing ? ' ✓' : ''} ({s.tasks})
        </Text>
      ))}
      {editing === null ? null : (
        <LineInput
          label={editing.kind === 'add' ? 'new status:' : 'rename:'}
          initial={editing.kind === 'add' ? '' : editing.name}
          onCancel={() => setEditing(null)}
          onSubmit={(name) => {
            // Open until the write is taken: a refusal keeps the text.
            if (editing.kind === 'rename') {
              void write((newId) => ({
                kind: 'saveStatus',
                opId: newId(),
                id: editing.id,
                name,
              })).then((r) => r.ok && setEditing(null));
              return;
            }
            void write((newId) => ({
              kind: 'saveStatus',
              opId: newId(),
              id: newId(),
              name,
              after: current?.id ?? null,
            })).then((r) => {
              if (!r.ok) return;
              setEditing(null);
              setAt(k + 1);
            });
          }}
        />
      )}
      <Text dimColor>
        a add · Enter rename · J/K move · c completing · dd delete · Esc back
      </Text>
    </Box>
  );
}

export const StatusesScreen = (p: { close: () => void }) => <Statuses {...p} />;
