import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Item } from '@todoer/client-core';
import { useTui } from './context.js';
import {
  indentTarget,
  insertAfter,
  moveAfter,
  outline,
} from './outline-tree.js';
import type { PaneProps } from './screens.js';
import { useTaskKeys } from './task-keys.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

const BAR = 8;
/** What some terminals send for Shift-Tab without Ink setting `shift`. */
const BACKTAB = '\u001b[Z';

/** `▓▓▓░░ 3/5` from the core's count of every live subtask (plan T1b), not
 *  only the ones this view lists. */
const bar = (item: Item) => {
  const p = item.subtasks;
  if (p === null || p.total === 0) return '';
  const done = Math.round((p.done / p.total) * BAR);
  return `${'▓'.repeat(done)}${'░'.repeat(BAR - done)} ${p.done}/${p.total}`;
};

const labels = (item: Item) =>
  [
    ...item.tags,
    ...(item.project === null ? [] : [`#${item.project}`]),
    ...(Number(item.priority ?? 0) > 0 ? [`p${String(item.priority)}`] : []),
    ...(typeof item.dueOn === 'string' ? [`due ${item.dueOn}`] : []),
  ].join(' ');

/**
 * The list layout: top-level tasks with their listed subtasks nested under
 * them. `h`/`l` fold, `Tab`/`Shift-Tab` re-parent, `J`/`K` move among
 * siblings (manual views only), `o`/`O` add a task or a subtask below the
 * cursor (where the sort puts it in a sorted view); the shared task keys come
 * from `useTaskKeys`.
 */
export function OutlinePane({ view, active, open }: PaneProps) {
  const { status } = useTui();
  const write = useWrite();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  // The cursor follows its task across a move or a re-parent; when the task
  // leaves the view (done, deleted) it stays at the same place.
  const [cursor, setCursor] = useState<{ at: number; id?: string }>({ at: 0 });
  // `after`: the task the new one follows (manual views only).
  const [adding, setAdding] = useState<null | {
    parentId?: string;
    after?: string;
  }>(null);
  const rows = outline(view.items, folded);
  const found = rows.findIndex((r) => r.item.id === cursor.id);
  const at = found >= 0 ? found : Math.min(cursor.at, rows.length - 1);
  const row = rows[at];
  const keys = useTaskKeys({ current: row?.item, viewKey: view.key, open });

  const go = (i: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, i));
    setCursor({ at: next, id: String(rows[next]?.item.id) });
  };

  const fold = (id: string, on: boolean) =>
    setFolded((f) => {
      const next = new Set(f);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const reparent = (taskId: string, parentId: string | null) =>
    void write((newId) => ({
      kind: 'reparent',
      opId: newId(),
      taskId,
      parentId,
    }));

  const move = (taskId: string, step: -1 | 1) => {
    if (view.sort !== 'manual') {
      status.say({
        tone: 'info',
        text: 'this view sorts itself: moving needs a manual view',
      });
      return;
    }
    const after = moveAfter(view.items, taskId, step);
    if (after === undefined) return;
    void write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId,
      view: view.key,
      after,
    }));
  };

  const below = (sub: boolean) =>
    row === undefined || view.sort !== 'manual'
      ? {}
      : { after: insertAfter(view.items, row.item, sub) };

  useInput(
    (input, key) => {
      // Pin the cursor to the task under it before the key acts on it.
      if (row !== undefined) setCursor({ at, id: String(row.item.id) });
      // Not before `handle`: it would erase the delete question before `y`.
      if (keys.handle(input, key)) return;
      status.clear();
      if (input === 'j' || (key.downArrow && !key.meta)) {
        go(at + 1);
      } else if (input === 'k' || (key.upArrow && !key.meta)) {
        go(at - 1);
      } else if (input === 'o') {
        setAdding(below(false));
      } else if (row === undefined) {
        return;
      } else if (input === 'O') {
        const parentId =
          row.depth === 0 ? String(row.item.id) : String(row.item.parentId);
        setAdding({ parentId, ...below(true) });
      } else if (input === 'h' || key.leftArrow) {
        if (row.children > 0) fold(String(row.item.id), true);
      } else if (input === 'l' || key.rightArrow) {
        fold(String(row.item.id), false);
      } else if (input === 'J' || (key.meta && key.downArrow)) {
        move(String(row.item.id), 1);
      } else if (input === 'K' || (key.meta && key.upArrow)) {
        move(String(row.item.id), -1);
      } else if ((key.tab && key.shift) || input === BACKTAB) {
        // Also a subtask whose parent this view does not list.
        if (typeof row.item.parentId === 'string') {
          reparent(String(row.item.id), null);
        }
      } else if (key.tab) {
        const target = indentTarget(rows, at);
        if (target === null) {
          status.say({ tone: 'info', text: 'nothing above to indent under' });
        } else {
          reparent(String(row.item.id), target);
        }
      }
    },
    { isActive: active && adding === null && !keys.busy },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {rows.length === 0 ? <Text dimColor>nothing here</Text> : null}
      {rows.map((r, i) => {
        const glyph =
          r.depth === 1
            ? '    '
            : r.children === 0
              ? '  '
              : r.folded
                ? '▸ '
                : '▾ ';
        // A subtask whose parent this view does not list.
        const orphan =
          r.depth === 0 && r.item.parentTitle !== null
            ? `${r.item.parentTitle} › `
            : '';
        return (
          <Box key={String(r.item.id)} justifyContent="space-between">
            <Text inverse={active && i === at}>
              {glyph}
              {r.item.closed ? '✓ ' : ''}
              {orphan}
              {String(r.item.title)}
              {r.folded ? <Text dimColor>{`  +${r.children}`}</Text> : null}
            </Text>
            <Text dimColor>
              {labels(r.item)} {bar(r.item)}
            </Text>
          </Box>
        );
      })}
      {keys.overlay}
      {adding === null ? null : (
        <LineInput
          label={adding.parentId === undefined ? 'new:' : 'new subtask:'}
          initial=""
          onCancel={() => setAdding(null)}
          onSubmit={(text) => {
            const { parentId, after } = adding;
            let id = '';
            // Open until the write is taken: a refusal keeps the text. The
            // engine ranks an add first, so a `move` puts it below the
            // cursor; refused, the task stays where the add put it.
            void write((newId) => {
              id = newId();
              return {
                kind: 'add',
                opId: newId(),
                id,
                text,
                ...(parentId === undefined ? {} : { parentId }),
              };
            }).then(async (r) => {
              if (!r.ok) return;
              setAdding(null);
              setCursor({ at, id });
              if (after === undefined) return;
              await write((newId) => ({
                kind: 'move',
                opId: newId(),
                taskId: id,
                view: view.key,
                after,
              }));
            });
          }}
        />
      )}
    </Box>
  );
}
