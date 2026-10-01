import { nameKey, type OpCreate } from '@todoer/specs';
import type { Row } from './store.js';

/** Tags quick-add and `list` can see: not deleted. */
export function liveTags(tags: Row[]): Row[] {
  return tags.filter((tag) => tag.deletedAt === null);
}

/** Projects in play: not deleted and not archived — an archived project is
 *  never matched or merged (quick-add design, Q5 and Q8). */
export function liveProjects(projects: Row[]): Row[] {
  return projects.filter(
    (project) =>
      project.deletedAt === null &&
      (project.archivedAt === null || project.archivedAt === undefined),
  );
}

/** Rows of any table that are not deleted. */
export function notDeleted(rows: Row[]): Row[] {
  return rows.filter((row) => row.deletedAt === null);
}

function idOf(row: Row): string {
  return String(row.id).toLowerCase();
}

/** Orders rows by id, lowest first. */
export function compareIds(a: Row, b: Row): number {
  return idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0;
}

/** Among rows sharing a name, the one every client picks: the lowest id
 *  (quick-add design, Q7). */
export function winner(rows: Row[]): Row | undefined {
  return [...rows].sort(compareIds)[0];
}

function named(pool: Row[], name: string): Row[] {
  const key = nameKey(name);
  return pool.filter(
    (row) => typeof row.name === 'string' && nameKey(row.name) === key,
  );
}

/** A TaskTag that ties its task to its tag: live, and not detached. */
export function isAttached(link: Row): boolean {
  return link.deletedAt === null && link.attached !== false;
}

export type Labels = {
  projectId: string | null;
  tagIds: string[];
  /** Creates for the names nothing matched, in the order to queue them. */
  creates: OpCreate[];
  /** What was created, as the caller typed it, for stderr. */
  created: string[];
};

/**
 * The rows a quick-add's `#project` and `@tags` mean. A name matches by name
 * key; among duplicates the lowest id wins; an unknown name becomes a create
 * (quick-add design, Q1, Q3). `@phone` is stored as `@phone`, `#finance` as
 * `finance` (Q2). A tag named twice counts once (plan departure 2).
 */
export function resolveLabels(
  wanted: { project: string | undefined; tags: string[] },
  rows: { projects: Row[]; tags: Row[] },
  newId: () => string,
  ts: string,
): Labels {
  const creates: OpCreate[] = [];
  const created: string[] = [];
  const create = (
    table: 'project' | 'tag',
    fields: Record<string, unknown>,
  ): string => {
    const id = newId();
    creates.push({ opId: newId(), kind: 'create', table, id, fields, ts });
    return id;
  };

  let projectId: string | null = null;
  if (wanted.project !== undefined) {
    const found = winner(named(liveProjects(rows.projects), wanted.project));
    if (found !== undefined) {
      projectId = String(found.id);
    } else {
      projectId = create('project', { name: wanted.project, rank: 'a0' });
      created.push(`#${wanted.project}`);
    }
  }

  const tagIds: string[] = [];
  const seen = new Set<string>();
  for (const name of wanted.tags) {
    const key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const found = winner(named(liveTags(rows.tags), name));
    if (found !== undefined) {
      tagIds.push(String(found.id));
    } else {
      tagIds.push(create('tag', { name }));
      created.push(name);
    }
  }
  return { projectId, tagIds, creates, created };
}

/**
 * A task's project name and its attached tags' names, sorted by name key.
 * Two duplicate tags on one task show once, spelled as the lowest-id one
 * spells it (plan departure 4).
 */
export function labelsOf(
  task: Row,
  rows: { projects: Row[]; tags: Row[]; links: Row[] },
): { project: string | null; tags: string[] } {
  const project = rows.projects.find(
    (row) => row.id === task.projectId && row.deletedAt === null,
  );
  const attached = new Set(
    rows.links
      .filter((link) => link.taskId === task.id && isAttached(link))
      .map((link) => String(link.tagId)),
  );
  const names = new Map<string, string>();
  for (const tag of [...liveTags(rows.tags)].sort(compareIds)) {
    if (!attached.has(String(tag.id)) || typeof tag.name !== 'string') {
      continue;
    }
    const key = nameKey(tag.name);
    if (!names.has(key)) names.set(key, tag.name);
  }
  return {
    project:
      project !== undefined && typeof project.name === 'string'
        ? project.name
        : null,
    tags: [...names.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, name]) => name),
  };
}
