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
