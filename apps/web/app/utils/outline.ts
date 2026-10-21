import type { ChildItem, Item } from '@todoer/client-core';

/** A top-level row of the list, its listed children nested under it, in view
 *  order, and its other live children, which the view does not list. */
export type Branch = { item: Item; nested: Item[]; context: ChildItem[] };
/** One project's top-level rows; `count` is the listed tasks in it, nested
 *  ones included, contextual children never. */
export type Group = {
  projectId: string | null;
  project: string | null;
  branches: Branch[];
  count: number;
  /** Each row's place among its siblings, for Move up/down. */
  edges: Map<string, { first: boolean; last: boolean }>;
};

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * The list's project → task → subtask outline (UX.md). A listed child nests
 * under its listed parent whatever its own project; a child whose parent the
 * view does not list stands in its own project. Groups sort by name, "No
 * project" last; rows keep the engine's order.
 */
export function outline(items: Item[], locale: string): Group[] {
  const listed = new Set(items.map((i) => String(i.id)));
  const parentOf = (i: Item) => {
    const p = str(i.parentId);
    return p !== null && listed.has(p) ? p : null;
  };
  const nested = new Map<string, Item[]>();
  for (const i of items) {
    const p = parentOf(i);
    if (p === null) continue;
    const kids = nested.get(p);
    if (kids === undefined) nested.set(p, [i]);
    else kids.push(i);
  }
  const groups = new Map<string | null, Group>();
  for (const i of items) {
    if (parentOf(i) !== null) continue;
    const projectId = str(i.projectId);
    let group = groups.get(projectId);
    if (group === undefined) {
      group = {
        projectId,
        project: i.project,
        branches: [],
        count: 0,
        edges: new Map(),
      };
      groups.set(projectId, group);
    }
    const kids = nested.get(String(i.id)) ?? [];
    group.branches.push({
      item: i,
      nested: kids,
      context: (i.children ?? []).filter((c) => !listed.has(c.id)),
    });
    group.count += 1 + kids.length;
  }
  for (const group of groups.values()) {
    mark(
      group.edges,
      group.branches.map((b) => b.item),
    );
    for (const b of group.branches) mark(group.edges, b.nested);
  }
  const collator = new Intl.Collator(locale);
  return [...groups.values()].sort((a, b) =>
    a.project === null
      ? 1
      : b.project === null
        ? -1
        : collator.compare(a.project, b.project),
  );
}

function mark(edges: Group['edges'], run: Item[]) {
  run.forEach((i, at) =>
    edges.set(String(i.id), { first: at === 0, last: at === run.length - 1 }),
  );
}

const branchOf = (group: Group, id: string) =>
  group.branches.find(
    (b) => b.item.id === id || b.nested.some((n) => n.id === id),
  );

/** The ids `id` moves among: its group's top-level rows, or its parent's
 *  listed children. */
export function siblings(group: Group, id: string): string[] {
  const branch = branchOf(group, id);
  if (branch === undefined) return [];
  return branch.item.id === id
    ? group.branches.map((b) => String(b.item.id))
    : branch.nested.map((n) => String(n.id));
}

/**
 * The `move` anchor for a drop of `taskId` after the row `after` (null: the
 * group's first), or undefined to ignore the drop. A root dropped among
 * another root's children follows that root; a child moves only among its
 * siblings, and right after its parent is first. Never a reparent.
 */
export function dropAfter(
  group: Group,
  taskId: string,
  after: string | null,
): string | null | undefined {
  const mine = branchOf(group, taskId);
  if (mine === undefined) return undefined;
  if (mine.item.id === taskId) {
    if (after === null) return null;
    const anchor = branchOf(group, after);
    if (anchor === undefined || anchor === mine) return undefined;
    return String(anchor.item.id);
  }
  if (after === mine.item.id) return null;
  return mine.nested.some((n) => n.id === after) ? after : undefined;
}

/** The row Indent puts the `at`-th top-level row under: the one above it,
 *  unless that is a subtask itself (two levels). */
export function indentUnder(
  group: Group,
  at: number,
): { id: string; title: string } | null {
  const prev = group.branches[at - 1]?.item;
  return prev && str(prev.parentId) === null
    ? { id: String(prev.id), title: String(prev.title) }
    : null;
}

/** Whether the core would let `item` become a subtask: a top-level one-off
 *  task without subtasks (two levels, ADR 0009). */
export const canIndent = (item: Item) =>
  str(item.parentId) === null &&
  item.subtasks === null &&
  str(item.rrule) === null;
