import { Text } from 'ink';
import type { ComponentType } from 'react';
import { BoardPane } from './board.js';
import { OutlinePane } from './outline.js';
import type { PaneProps } from './screens.js';

/** One pane per layout; calendar is not in v1. */
export const PANES: Record<string, ComponentType<PaneProps>> = {
  list: OutlinePane,
  kanban: BoardPane,
};

export function ViewPane(props: PaneProps) {
  const { view } = props;
  if (view.problem !== null) {
    return (
      <Text color="yellow">this view cannot be shown: {view.problem}</Text>
    );
  }
  const Pane = PANES[view.layout];
  if (Pane === undefined) {
    return <Text dimColor>the {view.layout} layout is not in the TUI yet</Text>;
  }
  return <Pane {...props} />;
}
