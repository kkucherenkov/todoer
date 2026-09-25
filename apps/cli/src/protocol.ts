/**
 * Pure helpers around the /sync wire protocol: merging changes into local
 * state, filtering to live task rows, and turning a raw fetch Response into
 * either a parsed SyncResponse or one of the two error classes ADR 0015's
 * exit codes are built on (1 for a refusal, 3 for anything else that is not
 * a clean 2xx). Kept free of `fetch` itself so all of it is testable against
 * a literal Response, with no network and no process.
 *
 * `Change`, `OpResult` and `SyncResponse` come from @todoer/specs rather
 * than being hand-rolled here — a contract change then breaks this build
 * instead of silently drifting from what the server actually sends. `Row`
 * and `State` have no wire equivalent (they describe this CLI's own local
 * cache) and stay local.
 */
import type { Change, OpResult, SyncResponse } from '@todoer/specs';

export type Row = Record<string, unknown>;
export type State = { cursor: number; rows: Record<string, Record<string, Row>> };

/** Exit 1: the server refused the request outright (HTTP 409) or refused
 *  one of the ops it was asked to apply. */
export class RefusalError extends Error {}
/** Exit 3: fetch itself threw, or the response was neither a clean 2xx nor
 *  a 409. */
export class NetworkError extends Error {}

/** Rows are keyed by table, then id — two tables can legally share an id
 *  (each table's ids are its own namespace), so keying by id alone would
 *  let a `project` row silently overwrite a `task` row and vice versa. */
export function applyChanges(state: State, changes: Change[]): void {
  for (const change of changes) {
    (state.rows[change.table] ??= {})[change.id] = change.row;
  }
}

/** Live (non-tombstoned) task rows — `list`'s whole surface. A row from any
 *  other table (project, tag, task_tag) is invisible here by construction,
 *  not by a filter that happens to skip it today. */
export function liveTasks(state: State): Row[] {
  return Object.values(state.rows.task ?? {}).filter((row) => row.deletedAt === null);
}

export async function readSyncResponse(response: Response): Promise<SyncResponse> {
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 409) throw new RefusalError(text);
    throw new NetworkError(`sync failed: ${response.status} ${text}`);
  }
  return (await response.json()) as SyncResponse;
}

/** Throws when the one op the caller minted `opId` for came back rejected —
 *  the other half of exit 1, alongside a 409. */
export function assertNotRejected(results: OpResult[], opId: string): void {
  const result = results.find((r) => r.opId === opId);
  if (result?.status === 'rejected') {
    throw new RefusalError(result.reason ?? 'the server refused this operation');
  }
}
