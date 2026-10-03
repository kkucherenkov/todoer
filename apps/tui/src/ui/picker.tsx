import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useHoldKeys } from '../key-hold.js';

export type PickerItem = { id: string; label: string };

/** A vertical choice: j/k or arrows move, Enter picks, Esc cancels. */
export function Picker({
  items,
  initial,
  onPick,
  onCancel,
  title,
}: {
  items: PickerItem[];
  initial?: string;
  onPick: (id: string) => void;
  onCancel: () => void;
  title?: string;
}) {
  const start = Math.max(
    0,
    items.findIndex((i) => i.id === initial),
  );
  useHoldKeys();
  const [at, setAt] = useState(start);
  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const item = items[at];
      if (item !== undefined) onPick(item.id);
      return;
    }
    if (input === 'j' || key.downArrow) {
      setAt((i) => Math.min(items.length - 1, i + 1));
    }
    if (input === 'k' || key.upArrow) setAt((i) => Math.max(0, i - 1));
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {title === undefined ? null : <Text bold>{title}</Text>}
      {items.map((item, i) => (
        <Text key={item.id} inverse={i === at}>
          {i === at ? '› ' : '  '}
          {item.label}
        </Text>
      ))}
    </Box>
  );
}
