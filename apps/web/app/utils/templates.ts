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
