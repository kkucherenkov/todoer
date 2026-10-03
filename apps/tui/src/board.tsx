import { Box, Text, useInput, useWindowSize } from 'ink';
import { useState } from 'react';
import { columns, moveAfterIn, visible } from './board-columns.js';
import { useTui } from './context.js';
import type { PaneProps } from './screens.js';
import { useTaskKeys } from './task-keys.js';
import { useTopic } from './topics.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

/** A column's width; more columns than fit scroll instead of narrowing. */
const COLUMN = 22;

/**
 * The kanban layout: one column per status, the engine's `boardTasks` (the
 * completing column holds the tasks closed in the last seven days). `H`/`L`
 * move a card across columns, `J`/`K` within one in a manual view.
 */
export function BoardPane({ view, active, open }: PaneProps) {
  const { topics, status } = useTui();
  const write = useWrite();
  const { columns: width } = useWindowSize();
  const statuses = useTopic(topics, 'catalog')?.statuses ?? [];
  const cols = columns(view.items, statuses);
  const [col, setCol] = useState(0);
  const [row, setRow] = useState(0);
  // The card the cursor stays on after it moves; `row` once it is gone.
  const [follow, setFollow] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const c = Math.max(0, Math.min(col, cols.length - 1));
  const cards = cols[c]?.items ?? [];
  const followed = cards.findIndex((i) => i.id === follow);
  const r =
    followed >= 0 ? followed : Math.max(0, Math.min(row, cards.length - 1));
  const current = cards[r];
  const keys = useTaskKeys({ current, viewKey: view.key, open });
  // The pane's border and padding take 4, the sidebar 22 from 80 (app.tsx).
  const room = width - (width >= 80 ? 26 : 4);
  const { from, to } = visible(
    cols.length,
    c,
    Math.max(1, Math.floor((room + 1) / (COLUMN + 1))),
  );

  const go = (nextCol: number, nextRow: number) => {
    setCol(nextCol);
    setRow(nextRow);
    setFollow(null);
  };

  const toColumn = (step: -1 | 1) => {
    if (current === undefined) return;
    const target = cols[c + step];
    if (target?.id == null) {
      if (cols[c]?.id === null) {
        status.say({
          tone: 'info',
          text: 'no statuses: nowhere to move · S adds some',
        });
      }
      return;
    }
    const taskId = String(current.id);
    const statusId = target.id;
    void write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId,
      view: view.key,
      statusId,
    }));
    setCol(c + step);
    setFollow(taskId);
  };

  const inColumn = (step: -1 | 1) => {
    if (current === undefined) return;
    if (view.sort !== 'manual') {
      status.say({
        tone: 'info',
        text: 'this view sorts itself: moving needs a manual view',
      });
      return;
    }
    const taskId = String(current.id);
    const after = moveAfterIn(cards, taskId, step);
    if (after === undefined) return;
    void write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId,
      view: view.key,
      after,
    }));
    setFollow(taskId);
  };

  useInput(
    (input, key) => {
      // Not before `handle`: it would erase the delete question before `y`.
      if (keys.handle(input, key)) return;
      status.clear();
      if (input === 'J' || (key.meta && key.downArrow)) inColumn(1);
      else if (input === 'K' || (key.meta && key.upArrow)) inColumn(-1);
      else if (input === 'H') toColumn(-1);
      else if (input === 'L') toColumn(1);
      else if (input === 'h' || key.leftArrow) go(Math.max(0, c - 1), 0);
      else if (input === 'l' || key.rightArrow) {
        go(Math.min(cols.length - 1, c + 1), 0);
      } else if (input === 'j' || key.downArrow) {
        go(c, Math.min(cards.length - 1, r + 1));
      } else if (input === 'k' || key.upArrow) go(c, Math.max(0, r - 1));
      else if (input === 'o') setAdding(true);
    },
    { isActive: active && !adding && !keys.busy },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        {cols.slice(from, to).map((column, k) => {
          const i = from + k;
          return (
            <Box
              key={column.id ?? 'tasks'}
              flexDirection="column"
              width={COLUMN}
              marginRight={1}
            >
              <Text
                bold
                wrap="truncate-end"
                {...(i === c ? { color: 'cyan' } : {})}
              >
                {column.name}
                {column.completing ? ' ✓' : ''} ({column.items.length})
              </Text>
              {column.items.map((item, n) => (
                <Text
                  key={String(item.id)}
                  wrap="truncate-end"
                  inverse={active && i === c && n === r}
                  dimColor={item.closed}
                >
                  {/* A mark as well as inverse: without colour Ink drops it. */}
                  {active && i === c && n === r ? '▸ ' : '  '}
                  {item.parentTitle === null ? '' : `${item.parentTitle} › `}
                  {String(item.title)}
                </Text>
              ))}
            </Box>
          );
        })}
      </Box>
      {from > 0 || to < cols.length ? (
        <Text dimColor>
          columns {from + 1}–{to} of {cols.length}
        </Text>
      ) : null}
      {keys.overlay}
      {adding ? (
        <LineInput
          label="new:"
          initial=""
          onCancel={() => setAdding(false)}
          onSubmit={(text) => {
            const statusId = cols[c]?.id ?? null;
            let id = '';
            // Open until the add is taken: a refusal keeps the text. A task
            // with no status shows in the first column (`displayStatus`), so
            // elsewhere a `move` follows the add.
            void write((newId) => {
              id = newId();
              return { kind: 'add', opId: newId(), id, text };
            }).then(async (added) => {
              if (!added.ok) return;
              setAdding(false);
              setFollow(id);
              if (statusId === null || c === 0) return;
              await write((newId) => ({
                kind: 'move',
                opId: newId(),
                taskId: id,
                view: view.key,
                statusId,
              }));
            });
          }}
        />
      ) : null}
    </Box>
  );
}
