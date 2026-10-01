import {
  filterProblem,
  nameKey,
  replaceIds,
  taskTagId,
  type Filter,
  type Op,
} from '@todoer/specs';
import {
  compareIds,
  isAttached,
  liveProjects,
  liveTags,
  notDeleted,
  winner,
} from './labels.js';
import type { Row } from './store.js';

export type Replica = {
  tasks: Row[];
  projects: Row[];
  tags: Row[];
  links: Row[];
  statuses: Row[];
  views: Row[];
};

/**
 * Groups of two or more rows sharing a name key, each sorted by id (winner
 * first) and the groups ordered by their winners' ids, so the plan does not
 * depend on the order rows arrive in. Only rows the server has
 * confirmed take part — they carry a `version` — because a loser is deleted
 * with its `baseVersion`, and a row still in the outbox may yet arrive as
 * someone else's duplicate (plan departure 1).
 */
function duplicates(rows: Row[]): Row[][] {
  const byKey = new Map<string, Row[]>();
  for (const row of rows) {
    if (typeof row.name !== 'string' || typeof row.version !== 'number') {
      continue;
    }
    const key = nameKey(row.name);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return [...byKey.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort(compareIds))
    .sort(([a], [b]) => compareIds(a as Row, b as Row));
}

/**
 * Each server-confirmed tombstone paired with the winner of the live,
 * server-confirmed rows sharing its name key, in tombstone id order; a
 * tombstone nothing live is named after is left out.
 */
function lateTombstones(rows: Row[], live: Row[]): [Row, Row][] {
  const confirmed = live.filter((row) => typeof row.version === 'number');
  return rows
    .filter(
      (row) =>
        row.deletedAt !== null &&
        typeof row.name === 'string' &&
        typeof row.version === 'number',
    )
    .sort(compareIds)
    .flatMap((tomb) => {
      const key = nameKey(String(tomb.name));
      const keep = winner(
        confirmed.filter(
          (row) => typeof row.name === 'string' && nameKey(row.name) === key,
        ),
      );
      return keep === undefined ? [] : [[tomb, keep] as [Row, Row]];
    });
}

/**
 * The operations that fold duplicate names into the lowest id (quick-add
 * design, Q7, Q10): a losing tag's attached links are re-made on the winner
 * and detached, a losing project's or status's live tasks are moved, then the
 * loser is deleted. The winner keeps its own fields. A live view whose filter
 * names a row that lost is rewritten to the winner, one write per view, after
 * the loser's own ops.
 *
 * Deterministic, so two clients that see the same duplicates plan the same
 * merge, and the derived TaskTag ids make the repeated creates idempotent.
 * The op order is by id, whatever the order of `replica`. A link of a deleted
 * or unknown task is left where it is.
 */
export function planMerge(
  replica: Replica,
  newId: () => string,
  ts: string,
): { ops: Op[]; merged: string[] } {
  const ops: Op[] = [];
  const merged: string[] = [];
  const tasks = [...replica.tasks].sort(compareIds);
  const liveTaskIds = new Set(
    tasks.filter((t) => t.deletedAt === null).map((t) => String(t.id)),
  );
  const links = [...replica.links].sort(compareIds);
  /** Every tag, project and status id that lost, to the id that took its place. */
  const replaced = new Map<string, string>();

  /** Re-makes `from`'s attached links of live tasks on `to` and detaches them. */
  const moveLinks = (from: Row, to: Row): number => {
    replaced.set(String(from.id), String(to.id));
    const before = ops.length;
    for (const link of links) {
      if (link.tagId !== from.id || !isAttached(link)) continue;
      const taskId = String(link.taskId);
      if (!liveTaskIds.has(taskId)) continue;
      ops.push({
        opId: newId(),
        kind: 'create',
        table: 'task_tag',
        id: taskTagId(taskId, String(to.id)),
        fields: { taskId, tagId: String(to.id), attached: true },
        ts,
      });
      ops.push({
        opId: newId(),
        kind: 'set',
        table: 'task_tag',
        id: String(link.id),
        field: 'attached',
        value: false,
        ts,
      });
    }
    return ops.length - before;
  };
  /** Moves `from`'s live tasks to `to`, by the task field `field`. */
  const moveRefs = (
    field: 'projectId' | 'statusId',
    from: Row,
    to: Row,
  ): number => {
    replaced.set(String(from.id), String(to.id));
    const before = ops.length;
    for (const task of tasks) {
      if (task[field] !== from.id || task.deletedAt !== null) continue;
      ops.push({
        opId: newId(),
        kind: 'set',
        table: 'task',
        id: String(task.id),
        field,
        value: String(to.id),
        ts,
      });
    }
    return ops.length - before;
  };
  const moveTasks = (from: Row, to: Row) => moveRefs('projectId', from, to);
  const moveStatus = (from: Row, to: Row) => moveRefs('statusId', from, to);

  for (const group of duplicates(liveTags(replica.tags))) {
    const [keep] = group;
    if (keep === undefined) continue;
    for (const loser of group) {
      if (loser === keep) continue;
      moveLinks(loser, keep);
      ops.push({
        opId: newId(),
        kind: 'delete',
        table: 'tag',
        id: String(loser.id),
        baseVersion: Number(loser.version),
      });
    }
    merged.push(`${String(keep.name)} (${String(group.length)})`);
  }

  for (const group of duplicates(liveProjects(replica.projects))) {
    const [keep] = group;
    if (keep === undefined) continue;
    for (const loser of group) {
      if (loser === keep) continue;
      moveTasks(loser, keep);
      ops.push({
        opId: newId(),
        kind: 'delete',
        table: 'project',
        id: String(loser.id),
        baseVersion: Number(loser.version),
      });
    }
    merged.push(`#${String(keep.name)} (${String(group.length)})`);
  }

  for (const group of duplicates(notDeleted(replica.statuses))) {
    const [keep] = group;
    if (keep === undefined) continue;
    for (const loser of group) {
      if (loser === keep) continue;
      moveStatus(loser, keep);
      ops.push({
        opId: newId(),
        kind: 'delete',
        table: 'status',
        id: String(loser.id),
        baseVersion: Number(loser.version),
      });
    }
    merged.push(`${String(keep.name)} (${String(group.length)})`);
  }

  // A device that was offline can attach a tag, or a project, that has been
  // merged away since: the server accepts it, and nothing above sees it
  // because the tombstone is in no group. Move it to the live winner.
  for (const [tomb, keep] of lateTombstones(
    replica.tags,
    liveTags(replica.tags),
  )) {
    if (moveLinks(tomb, keep) > 0)
      merged.push(`${String(keep.name)} (late links)`);
  }
  for (const [tomb, keep] of lateTombstones(
    replica.projects,
    liveProjects(replica.projects),
  )) {
    if (moveTasks(tomb, keep) > 0) {
      merged.push(`#${String(keep.name)} (late tasks)`);
    }
  }
  for (const [tomb, keep] of lateTombstones(
    replica.statuses,
    notDeleted(replica.statuses),
  )) {
    if (moveStatus(tomb, keep) > 0) {
      merged.push(`${String(keep.name)} (late tasks)`);
    }
  }

  // A view naming a row that just lost keeps pointing at the winner
  // (plan V1, departure 6). One write per view, whatever it names.
  for (const view of [...notDeleted(replica.views)].sort(compareIds)) {
    if (filterProblem(view.filter) !== null) continue;
    const next = replaceIds(view.filter as Filter, replaced);
    if (next === view.filter) continue;
    ops.push({
      opId: newId(),
      kind: 'set',
      table: 'view',
      id: String(view.id),
      field: 'filter',
      value: next,
      ts,
    });
  }
  return { ops, merged };
}
