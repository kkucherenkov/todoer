import { filterSize, type Catalog, type Filter } from '@todoer/client-core';
import type { ComputedRef, InjectionKey } from 'vue';

/** Child indexes from the root; a `not` has one child, at 0. */
export type Path = readonly number[];
export type LeafKind =
  'tag' | 'project' | 'status' | 'priority' | 'scheduled' | 'due' | 'recurring';

/** What FilterTree gives its nodes: the root, and the one way to change it. */
export type TreeContext = {
  root: ComputedRef<Filter>;
  edit(fn: (root: Filter) => Filter): void;
};
export const TREE: InjectionKey<TreeContext> = Symbol('filterTree');

const KEYS = new Set<string>([
  'and',
  'or',
  'not',
  'tag',
  'project',
  'status',
  'priority',
  'scheduled',
  'due',
  'recurring',
]);
// One level and one node past what filterProblem allows, so a tree that is
// over the limits can still be drawn and trimmed.
const MAX_DEPTH = 9;
const MAX_NODES = 257;
const LIMIT_DEPTH = 8;
const LIMIT_NODES = 256;

/**
 * Whether the tree can be drawn: every node one known key with the right
 * container (arrays under and/or, an object under not). Leaf values may be
 * invalid; filterProblem says so. Bounded at depth 9 and 257 nodes.
 */
export function editable(filter: unknown): filter is Filter {
  let nodes = 0;
  const ok = (node: unknown, depth: number): boolean => {
    nodes += 1;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) return false;
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return false;
    }
    const keys = Object.keys(node);
    const key = keys[0];
    if (keys.length !== 1 || key === undefined || !KEYS.has(key)) return false;
    const value = (node as Record<string, unknown>)[key];
    if (key === 'and' || key === 'or') {
      return Array.isArray(value) && value.every((c) => ok(c, depth + 1));
    }
    return key === 'not' ? ok(value, depth + 1) : true;
  };
  return ok(filter, 1);
}

export function children(node: Filter): Filter[] {
  if ('and' in node) return node.and;
  if ('or' in node) return node.or;
  return 'not' in node ? [node.not] : [];
}

export function at(root: Filter, path: Path): Filter {
  return path.reduce((node, i) => children(node)[i] as Filter, root);
}

/** A group or a `not` rebuilt over `kids`; the operator is kept. */
function withChildren(node: Filter, kids: Filter[]): Filter {
  if ('and' in node) return { and: kids };
  if ('or' in node) return { or: kids };
  if ('not' in node) return { not: kids[0] as Filter };
  throw new Error('a leaf has no children');
}

const isGroup = (node: Filter) => 'and' in node || 'or' in node;
function groupAt(root: Filter, path: Path): Filter {
  const node = at(root, path);
  if (!isGroup(node)) throw new Error('not a group');
  return node;
}

/** A new tree with `node` at `path`; every untouched subtree is the same object,
 * and so is the root when `node` is already there. */
export function replace(root: Filter, path: Path, node: Filter): Filter {
  const [i, ...rest] = path;
  if (i === undefined) return node;
  const kids = children(root).slice();
  const old = kids[i] as Filter;
  kids[i] = replace(old, rest, node);
  return kids[i] === old ? root : withChildren(root, kids);
}

/**
 * Removes the node from its group; inside a `not` removes the `not`; the
 * root becomes { and: [] }.
 */
export function remove(root: Filter, path: Path): Filter {
  if (path.length === 0) return { and: [] };
  const parentPath = path.slice(0, -1);
  const parent = at(root, parentPath);
  if ('not' in parent) return remove(root, parentPath);
  const kids = children(parent).filter((_, i) => i !== path[path.length - 1]);
  return replace(root, parentPath, withChildren(parent, kids));
}

export function append(root: Filter, to: Path, node: Filter): Filter {
  const parent = groupAt(root, to);
  return replace(root, to, withChildren(parent, [...children(parent), node]));
}

/** Wraps the node in a `not`, or unwraps a `not`. */
export function toggleNot(root: Filter, path: Path): Filter {
  const node = at(root, path);
  return replace(root, path, 'not' in node ? node.not : { not: node });
}

/** and ↔ or, keeping the children. */
export function setGroup(root: Filter, path: Path, op: 'and' | 'or'): Filter {
  const kids = children(groupAt(root, path));
  return replace(root, path, { [op]: kids } as Filter);
}

/**
 * A new leaf or group: tag and status take the first catalog id in
 * lower-case, or '' (which filterProblem refuses); project null; priority
 * [4]; ranges {}; recurring true.
 */
export function blank(kind: LeafKind | 'and' | 'or', catalog: Catalog): Filter {
  switch (kind) {
    case 'and':
      return { and: [] };
    case 'or':
      return { or: [] };
    case 'tag':
      return { tag: catalog.tags[0]?.id.toLowerCase() ?? '' };
    case 'status':
      return { status: catalog.statuses[0]?.id.toLowerCase() ?? '' };
    case 'project':
      return { project: null };
    case 'priority':
      return { priority: [4] };
    case 'scheduled':
      return { scheduled: {} };
    case 'due':
      return { due: {} };
    case 'recurring':
      return { recurring: true };
  }
}

/** Whether a child can be added to the group at `path` without passing the limits. */
export function canAdd(root: Filter, path: Path): boolean {
  const { nodes, depth } = filterSize(root);
  return (
    isGroup(at(root, path)) &&
    nodes < LIMIT_NODES &&
    path.length + 2 <= LIMIT_DEPTH &&
    depth <= LIMIT_DEPTH
  );
}

/** Whether `toggleNot` at `path` stays within the limits: a wrap adds a node
 * and a level, an unwrap never does. */
export function canToggleNot(root: Filter, path: Path): boolean {
  const { nodes, depth } = filterSize(toggleNot(root, path));
  return nodes <= LIMIT_NODES && depth <= LIMIT_DEPTH;
}
