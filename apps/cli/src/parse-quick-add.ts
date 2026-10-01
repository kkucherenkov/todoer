import { UsageError } from './protocol.js';

export type QuickAdd = {
  title: string;
  tags: string[];
  project: string | undefined;
  priority: number;
};

// A token only counts when it stands alone, which is what keeps `a@b.c` from
// being read as a tag and `p5` from being read as a priority.
export const TAG = /^@[\p{L}\p{N}_-]+$/u;
export const PROJECT = /^#[\p{L}\p{N}_-]+$/u;
const PRIORITY = /^p([0-4])$/;

export function parseQuickAdd(input: string): QuickAdd {
  const title: string[] = [];
  const tags: string[] = [];
  let project: string | undefined;
  let priority = 0;

  for (const token of input.split(/\s+/).filter((t) => t.length > 0)) {
    if (TAG.test(token)) {
      tags.push(token);
      continue;
    }
    if (PROJECT.test(token)) {
      project = token.slice(1);
      continue;
    }
    const p = PRIORITY.exec(token);
    if (p !== null && p[1] !== undefined) {
      priority = Number(p[1]);
      continue;
    }
    title.push(token);
  }

  return { title: title.join(' '), tags, project, priority };
}

/**
 * What `add` is going to send: the title, the priority, and the names of the
 * project and tags the markers ask for. Refuses text that leaves no title —
 * `todoer add "#groceries"` once created a task with no title at all.
 * Resolving the names to rows is `labels.ts`'s job.
 */
export function planAdd(text: string): {
  title: string;
  priority: number;
  project: string | undefined;
  tags: string[];
} {
  const parsed = parseQuickAdd(text);
  if (parsed.title === '') {
    throw new UsageError(
      `no title in ${JSON.stringify(text)} — #project and @tag markers do not make one`,
    );
  }
  return {
    title: parsed.title,
    priority: parsed.priority,
    project: parsed.project,
    tags: parsed.tags,
  };
}
