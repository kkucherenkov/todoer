import type { Item } from '@todoer/client-core';

export type OutlineRow = {
  item: Item;
  depth: 0 | 1;
  /** Listed subtasks (top-level rows only). */
  children: number;
  /** Of those, the ones not closed. */
  open: number;
  folded: boolean;
};

/** Each item's listed parent: its id, or null for a top-level task and for
 *  one whose parent the view does not list (it then stands at the top with
 *  `parent ›`). */
function parentsOf(items: Item[]): (item: Item) => string | null {
  const listed = new Set(items.map((i) => String(i.id)));
  return (item) =>
    typeof item.parentId === 'string' && listed.has(item.parentId)
      ? item.parentId
      : null;
}

/** Parents in view order, each followed by its listed subtasks in view
 *  order, unless folded. The engine already sorted `items`. */
export function outline(
  items: Item[],
  folded: ReadonlySet<string>,
): OutlineRow[] {
  const parentOf = parentsOf(items);
  const kids = new Map<string, Item[]>();
  for (const i of items) {
    const p = parentOf(i);
    if (p !== null) kids.set(p, [...(kids.get(p) ?? []), i]);
  }
  const rows: OutlineRow[] = [];
  for (const i of items) {
    if (parentOf(i) !== null) continue;
    const mine = kids.get(String(i.id)) ?? [];
    const isFolded = mine.length > 0 && folded.has(String(i.id));
    rows.push({
      item: i,
      depth: 0,
      children: mine.length,
      open: mine.filter((k) => !k.closed).length,
      folded: isFolded,
    });
    if (isFolded) continue;
    for (const k of mine) {
      rows.push({ item: k, depth: 1, children: 0, open: 0, folded: false });
    }
  }
  return rows;
}

/** The task Tab puts row `at` under: the nearest top-level row above it.
 *  Null for the first row and for a subtask (two levels only). */
export function indentTarget(rows: OutlineRow[], at: number): string | null {
  if (rows[at]?.depth !== 0) return null;
  for (let i = at - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.depth === 0) return String(row.item.id);
  }
  return null;
}

/**
 * The `after` anchor that moves `taskId` one place among its siblings (same
 * listed parent), for the engine's `move`: the engine places the task right
 * after the anchor in rank order, and ranks are global, so the sibling order
 * comes out right whatever lies between. `null` is first in the whole view,
 * which is also first among the siblings. `undefined`: already at that end.
 */
export function moveAfter(
  items: Item[],
  taskId: string,
  step: -1 | 1,
): string | null | undefined {
  const parentOf = parentsOf(items);
  const me = items.find((i) => i.id === taskId);
  if (me === undefined) return undefined;
  const parent = parentOf(me);
  const siblings = items.filter((i) => parentOf(i) === parent);
  const k = siblings.findIndex((i) => i.id === taskId);
  if (step === -1) {
    if (k <= 0) return undefined;
    return k === 1 ? null : String(siblings[k - 2]?.id);
  }
  const next = siblings[k + 1];
  return next === undefined ? undefined : String(next.id);
}
