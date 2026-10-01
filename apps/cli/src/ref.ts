import { UsageError } from '@todoer/client-core';
import type { Row } from './store.js';

/**
 * How `list` names a task: the last six characters of its id. Suffix, not
 * prefix — a UUIDv7 starts with a millisecond timestamp, so tasks created
 * minutes apart share their first characters (plan C design, Q10).
 */
export function shortRef(id: string): string {
  return id.slice(-6);
}

const REF = /^[0-9a-f-]{4,}$/i;

/**
 * The task a caller means: the full id, or the only id ending in `ref`.
 * Every miss is a usage error (exit 2) that says how to fix it, and an
 * ambiguous suffix lists the candidates rather than guessing — completing
 * the wrong task is silent damage.
 */
export function resolveRef(tasks: Row[], ref: string): Row {
  if (!REF.test(ref)) {
    throw new UsageError(
      `${JSON.stringify(ref)} is not a task id or an id suffix of at least 4 hex digits`,
    );
  }
  const wanted = ref.toLowerCase();
  const id = (task: Row): string => String(task.id).toLowerCase();
  const exact = tasks.find((task) => id(task) === wanted);
  if (exact !== undefined) return exact;
  const matches = tasks.filter((task) => id(task).endsWith(wanted));
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;
  if (matches.length === 0) throw new UsageError(`no task matches ${ref}`);
  const names = matches
    .map((task) => `${shortRef(String(task.id))} ${String(task.title)}`)
    .join('; ');
  throw new UsageError(
    `${ref} matches ${String(matches.length)} tasks: ${names} — give more of the id`,
  );
}
