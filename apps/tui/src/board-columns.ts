import type { Catalog, Item } from '@todoer/client-core';

export type Column = {
  id: string | null;
  name: string;
  completing: boolean;
  items: Item[];
};

/** One column per status in rank order (the catalog's order), each with the
 *  items whose `column` is that status, in the view's order. No statuses:
 *  one column, the way `displayStatus` leaves every column null. */
export function columns(
  items: Item[],
  statuses: Catalog['statuses'],
): Column[] {
  if (statuses.length === 0) {
    return [{ id: null, name: 'Tasks', completing: false, items }];
  }
  return statuses.map((s) => ({
    id: s.id,
    name: s.name,
    completing: s.completing,
    items: items.filter((i) => i.column === s.id),
  }));
}

/** The columns `[from, to)` that fit `fit` at a time with `at` among them. */
export function visible(
  count: number,
  at: number,
  fit: number,
): { from: number; to: number } {
  if (count <= fit) return { from: 0, to: count };
  const from = Math.min(Math.max(0, at - fit + 1), count - fit);
  return { from, to: from + fit };
}

/** The engine's `after` anchor for moving a card one place in its column
 *  (null: first); undefined at that end. The engine ranks the card among
 *  the column's other cards, so the card it should follow is enough. */
export function moveAfterIn(
  column: Item[],
  taskId: string,
  step: -1 | 1,
): string | null | undefined {
  const k = column.findIndex((i) => i.id === taskId);
  if (k < 0) return undefined;
  if (step === -1) {
    if (k === 0) return undefined;
    return k === 1 ? null : String(column[k - 2]?.id);
  }
  const next = column[k + 1];
  return next === undefined ? undefined : String(next.id);
}
