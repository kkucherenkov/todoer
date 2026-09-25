import { UsageError } from './protocol.js';

export type QuickAdd = {
  title: string;
  tags: string[];
  project: string | undefined;
  priority: number;
};

// A token only counts when it stands alone, which is what keeps `a@b.c` from
// being read as a tag and `p5` from being read as a priority.
const TAG = /^@[\p{L}\p{N}_-]+$/u;
const PROJECT = /^#[\p{L}\p{N}_-]+$/u;
const PRIORITY = /^p([0-4])$/;

export function parseQuickAdd(input: string): QuickAdd {
  const title: string[] = [];
  const tags: string[] = [];
  let project: string | undefined;
  let priority = 0;

  for (const token of input.split(/\s+/).filter((t) => t.length > 0)) {
    if (TAG.test(token)) { tags.push(token); continue; }
    if (PROJECT.test(token)) { project = token.slice(1); continue; }
    const p = PRIORITY.exec(token);
    if (p !== null && p[1] !== undefined) { priority = Number(p[1]); continue; }
    title.push(token);
  }

  return { title: title.join(' '), tags, project, priority };
}

/**
 * What `add` is actually going to send, and what it owes the caller an
 * explanation for.
 *
 * Quick-add parses `#project` and `@tag`, and plan A stores neither: creating
 * the `project`, `tag` and `task_tag` rows they imply is plan B's work. The
 * defect was never that they are unstored, it was that they were consumed
 * silently — `todoer add "#groceries"` created a task with no title at all
 * and exited 0, which is a caller's data quietly going nowhere.
 */
export function planAdd(text: string): {
  title: string;
  priority: number;
  notice: string | null;
} {
  const parsed = parseQuickAdd(text);
  if (parsed.title === '') {
    throw new UsageError(
      `no title in ${JSON.stringify(text)} — #project and @tag markers do not make one`,
    );
  }
  const dropped = [
    ...(parsed.project !== undefined ? [`#${parsed.project}`] : []),
    ...parsed.tags,
  ];
  return {
    title: parsed.title,
    priority: parsed.priority,
    notice:
      dropped.length === 0
        ? null
        : `note: ${dropped.join(' ')} parsed but not stored — projects and tags are not in this release`,
  };
}
