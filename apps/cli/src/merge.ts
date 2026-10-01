import { nameKey, taskTagId, type Op } from '@todoer/specs';
import { isAttached, liveProjects, liveTags, winner } from './labels.js';
import type { Row } from './store.js';

export type View = { tasks: Row[]; projects: Row[]; tags: Row[]; links: Row[] };

/**
 * Groups of two or more rows sharing a name key. Only rows the server has
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
  return [...byKey.values()].filter((group) => group.length > 1);
}

/**
 * The operations that fold duplicate names into the lowest id (quick-add
 * design, Q7, Q10): a losing tag's attached links are re-made on the winner
 * and detached, a losing project's live tasks are moved, then the loser is
 * deleted. The winner keeps its own fields. Deterministic, so two clients
 * that see the same duplicates plan the same merge, and the derived TaskTag
 * ids make the repeated creates idempotent.
 */
export function planMerge(
  view: View,
  newId: () => string,
  ts: string,
): { ops: Op[]; merged: string[] } {
  const ops: Op[] = [];
  const merged: string[] = [];

  for (const group of duplicates(liveTags(view.tags))) {
    const keep = winner(group);
    if (keep === undefined) continue;
    const keepId = String(keep.id);
    for (const loser of group) {
      if (loser === keep) continue;
      for (const link of view.links) {
        if (link.tagId !== loser.id || !isAttached(link)) continue;
        const taskId = String(link.taskId);
        ops.push({
          opId: newId(),
          kind: 'create',
          table: 'task_tag',
          id: taskTagId(taskId, keepId),
          fields: { taskId, tagId: keepId, attached: true },
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

  for (const group of duplicates(liveProjects(view.projects))) {
    const keep = winner(group);
    if (keep === undefined) continue;
    const keepId = String(keep.id);
    for (const loser of group) {
      if (loser === keep) continue;
      for (const task of view.tasks) {
        if (task.projectId !== loser.id || task.deletedAt !== null) continue;
        ops.push({
          opId: newId(),
          kind: 'set',
          table: 'task',
          id: String(task.id),
          field: 'projectId',
          value: keepId,
          ts,
        });
      }
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
  return { ops, merged };
}
