import type { Filter } from '@todoer/client-core';

export type Template =
  | { kind: 'today' }
  | { kind: 'overdue' }
  | { kind: 'next7' }
  | { kind: 'project'; id: string | null }
  | { kind: 'tag'; id: string }
  | { kind: 'status'; id: string };

/** The tree each template writes (departure 9). Ids go in lower-case: the
 *  server compares a filter's strings as written. */
export function filterOf(t: Template): Filter {
  switch (t.kind) {
    case 'today':
      return { or: [{ scheduled: { to: 0 } }, { due: { to: 0 } }] };
    case 'overdue':
      return { due: { to: -1 } };
    case 'next7':
      return {
        or: [{ scheduled: { from: 0, to: 6 } }, { due: { from: 0, to: 6 } }],
      };
    case 'project':
      return { project: t.id?.toLowerCase() ?? null };
    case 'tag':
      return { tag: t.id.toLowerCase() };
    case 'status':
      return { status: t.id.toLowerCase() };
  }
}

const FIXED = ['today', 'overdue', 'next7'] as const;

/** The template a stored filter is exactly, or null (→ raw-JSON mode). */
export function templateOf(filter: unknown): Template | null {
  const json = JSON.stringify(filter);
  for (const kind of FIXED) {
    if (json === JSON.stringify(filterOf({ kind }))) return { kind };
  }
  if (typeof filter !== 'object' || filter === null) return null;
  const entries = Object.entries(filter);
  if (entries.length !== 1) return null;
  const [key, id] = entries[0]!;
  if (key === 'project' && (id === null || typeof id === 'string')) {
    return { kind: 'project', id };
  }
  if ((key === 'tag' || key === 'status') && typeof id === 'string') {
    return { kind: key, id };
  }
  return null;
}
