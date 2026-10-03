import { parseQuickAdd, type TaskChanges } from '@todoer/client-core';

export type LineFields = {
  title: unknown;
  tags: string[];
  project: string | null;
  priority: unknown;
};

/** A task as one quick-add line: `title @tags #project pN`. */
export function lineOf(item: LineFields): string {
  const priority = Number(item.priority ?? 0);
  return [
    String(item.title),
    ...item.tags,
    ...(item.project === null ? [] : [`#${item.project}`]),
    ...(priority > 0 ? [`p${priority}`] : []),
  ].join(' ');
}

/** What an edited line changes, field by field; `{}` when nothing did. */
export function lineChanges(item: LineFields, line: string): TaskChanges {
  const parsed = parseQuickAdd(line);
  const changes: TaskChanges = {};
  if (parsed.title !== String(item.title)) changes.title = parsed.title;
  const before = new Set(item.tags);
  if (
    parsed.tags.length !== before.size ||
    parsed.tags.some((t) => !before.has(t))
  ) {
    changes.tags = parsed.tags;
  }
  const project = parsed.project ?? null;
  if (project !== item.project) changes.project = project;
  if (parsed.priority !== Number(item.priority ?? 0)) {
    changes.priority = parsed.priority;
  }
  return changes;
}
