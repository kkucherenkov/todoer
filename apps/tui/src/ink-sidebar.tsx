import { Box, Text } from 'ink';
import type { Catalog } from '@todoer/client-core';
import { ALL } from '@todoer/client-core';

export type ViewEntry = { key: string; name: string };

/** "All open" first, then the saved views by rank (catalog order). */
export const viewEntries = (catalog: Catalog | undefined): ViewEntry[] => [
  { key: ALL, name: 'All open' },
  ...(catalog?.views ?? []).map((v) => ({ key: v.id, name: v.name })),
];

export function Sidebar({
  entries,
  current,
}: {
  entries: ViewEntry[];
  current: string;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={22}>
      <Text bold>Views</Text>
      {entries.map((e) => (
        <Text key={e.key} {...(e.key === current ? { color: 'cyan' } : {})}>
          {e.key === current ? '▸ ' : '  '}
          {e.name}
        </Text>
      ))}
    </Box>
  );
}
