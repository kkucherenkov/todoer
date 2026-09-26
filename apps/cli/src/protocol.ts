/**
 * Pure helpers around the /sync wire protocol: merging changes into local
 * state, filtering to live task rows, and turning a raw fetch Response into
 * either a parsed SyncResponse or one of the error classes ADR 0015 §2's
 * exit codes are built on. Kept free of `fetch` itself so all of it is
 * testable against a literal Response, with no network and no process.
 *
 * The four classes below are this CLI's whole exit-code vocabulary, and the
 * only place the mapping is decided — `index.ts` does nothing but translate
 * them into a status. §2 asks for a caller to be able to branch on the
 * outcome without parsing text, and the branch that matters to an agent is
 * "retry" against "do something else": only NetworkError is the first.
 *
 * `Change`, `OpResult` and `SyncResponse` come from @todoer/specs rather
 * than being hand-rolled here — a contract change then breaks this build
 * instead of silently drifting from what the server actually sends. `Row`
 * and `State` have no wire equivalent (they describe this CLI's own local
 * cache) and stay local.
 */
import type { Change, OpResult, SyncResponse } from '@todoer/specs';

export type Row = Record<string, unknown>;
export type State = {
  cursor: number;
  rows: Record<string, Record<string, Row>>;
};

/** Exit 1: the server refused — a 4xx, or a rejected operation. Retrying the
 *  same request cannot change the answer; something about it has to change
 *  first, and for a 401 that something is the token. */
export class RefusalError extends Error {}
/** Exit 2: the invocation itself is wrong — an unknown command, or text that
 *  leaves no title. Nothing was sent. */
export class UsageError extends Error {}
/** Exit 3: the server was not reached, or answered 5xx. The one outcome a
 *  caller may retry unchanged. */
export class NetworkError extends Error {}
/** Exit 4: the operation lost an optimistic-lock check — the server holds a
 *  newer version of the row. A retry needs the current row first. */
export class ConflictError extends Error {}

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
  return Object.values(state.rows.task ?? {}).filter(
    (row) => row.deletedAt === null,
  );
}

/**
 * Split at 500, not at a list of statuses. Every 4xx /sync declares is the
 * server refusing this request as it stands — 401 needs a new token, 413 a
 * smaller batch, 410 a fresh snapshot — and none of them becomes true by
 * being sent again. The previous split (409 refusal, everything else a
 * network error) put an expired token in the same bucket as an unreachable
 * host, so an agent retried a 15-minute token expiry forever, and it tested
 * a 409 that this endpoint does not declare and the server never sends.
 */
export async function readSyncResponse(
  response: Response,
): Promise<SyncResponse> {
  if (!response.ok) {
    const text = await response.text();
    if (response.status < 500) {
      throw new RefusalError(`sync refused: ${response.status} ${text}`);
    }
    throw new NetworkError(`sync failed: ${response.status} ${text}`);
  }
  return (await response.json()) as SyncResponse;
}

/**
 * Throws when the one op the caller minted `opId` for did not take effect.
 * `/sync` answers 200 and reports each operation's fate in the body, so this
 * — not the HTTP status — is where a refusal and a conflict actually arrive.
 *
 * `duplicate` and `superseded` are deliberately silent: both mean the
 * caller's intent is already in the server's state.
 *
 * A response that does not mention the operation at all is a refusal, not a
 * success. The server applies each operation and reports it; a missing entry
 * means something between the intent and the answer went wrong, and the one
 * thing the caller must not do is take exit 0 for "the task exists". Not a
 * NetworkError either: a blind retry of an `add` whose fate is unknown is how
 * the same task gets created twice, since this CLI mints a fresh operation id
 * per invocation (ADR 0015 §4).
 */
export function assertNotRefused(results: OpResult[], opId: string): void {
  const result = results.find((r) => r.opId === opId);
  if (result === undefined) {
    throw new RefusalError(
      `the server did not report operation ${opId} — run list before retrying`,
    );
  }
  if (result.status === 'rejected') {
    throw new RefusalError(
      result.reason ?? 'the server refused this operation',
    );
  }
  if (result.status === 'conflict') {
    throw new ConflictError(
      `the server holds a newer version of this row (version ${String(result.currentVersion)})`,
    );
  }
}

/**
 * What happened to the one operation the running command queued, in a
 * response that may carry many. Throws when the server refused it, so the
 * command's exit code says so. `unreported` is not an error: the operation
 * is still in the outbox with its id, and a later command resends it safely.
 */
export function ownOutcome(
  results: OpResult[],
  opId: string,
): 'settled' | 'unreported' {
  const result = results.find((r) => r.opId === opId);
  if (result === undefined) return 'unreported';
  if (result.status === 'rejected') {
    throw new RefusalError(
      result.reason ?? 'the server refused this operation',
    );
  }
  if (result.status === 'conflict') {
    throw new ConflictError(
      `the server holds a newer version of this row (version ${String(result.currentVersion)})`,
    );
  }
  return 'settled';
}
