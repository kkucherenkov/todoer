import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useTui } from './context.js';
import type { PaneProps } from './screens.js';
import { useTaskKeys } from './task-keys.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

/**
 * The shell's pane: one row per item, no nesting. The outline and board
 * stubs point at it until their plans land.
 */
export function FlatList({ view, active, open }: PaneProps) {
  const { status } = useTui();
  const write = useWrite();
  const [at, setAt] = useState(0);
  const [adding, setAdding] = useState(false);
  const items = view.items;
  const current = items[Math.min(at, items.length - 1)];
  const keys = useTaskKeys({ current, viewKey: view.key, open });

  useInput(
    (input, key) => {
      // Not before `handle`: it would erase the delete question before `y`.
      if (keys.handle(input, key)) return;
      status.clear();
      if (input === 'j' || key.downArrow) {
        setAt((i) => Math.min(items.length - 1, i + 1));
      } else if (input === 'k' || key.upArrow) {
        setAt((i) => Math.max(0, i - 1));
      } else if (input === 'o') {
        setAdding(true);
      }
    },
    { isActive: active && !adding && !keys.busy },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {items.length === 0 ? <Text dimColor>nothing here</Text> : null}
      {items.map((item, i) => (
        <Text key={String(item.id)} inverse={active && i === at}>
          {item.closed ? '✓ ' : '  '}
          {item.parentTitle === null ? '' : `${item.parentTitle} › `}
          {String(item.title)}
        </Text>
      ))}
      {keys.overlay}
      {adding ? (
        <LineInput
          label="new:"
          initial=""
          onCancel={() => setAdding(false)}
          onSubmit={(text) => {
            // Open until the write is taken: a refusal keeps the text.
            void write((newId) => ({
              kind: 'add',
              opId: newId(),
              id: newId(),
              text,
            })).then((r) => r.ok && setAdding(false));
          }}
        />
      ) : null}
    </Box>
  );
}
