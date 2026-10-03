import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';
import { useHoldKeys } from '../key-hold.js';

/** One editable line: Enter submits, Esc cancels. */
export function LineInput({
  initial,
  onSubmit,
  onCancel,
  label,
}: {
  initial: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  label?: string;
}) {
  useHoldKeys();
  const [value, setValue] = useState(initial);
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });
  return (
    <Box>
      {label === undefined ? null : <Text dimColor>{label} </Text>}
      <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
    </Box>
  );
}
