import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import { useTui } from './context.js';
import { useTopic } from './topics.js';

/** Sync state on the left; the status line's message, else key hints. */
export function StatusBar({ hints }: { hints: string }) {
  const { topics, status } = useTui();
  const sync = useTopic(topics, 'sync');
  const message = useSyncExternalStore(status.subscribe, () => status.message);
  const state =
    sync === undefined
      ? 'starting'
      : sync.running
        ? 'syncing…'
        : sync.reached === false
          ? `offline · ${sync.pending} pending`
          : sync.pending > 0
            ? `${sync.pending} pending`
            : 'synced';
  const failed =
    sync !== undefined && sync.failed > 0 ? ` · ${sync.failed} failed` : '';
  return (
    <Box justifyContent="space-between">
      <Text dimColor>
        {state}
        {failed}
      </Text>
      {message === null ? (
        <Text dimColor>{hints}</Text>
      ) : (
        <Text color={message.tone === 'error' ? 'red' : 'green'}>
          {message.text}
        </Text>
      )}
    </Box>
  );
}
