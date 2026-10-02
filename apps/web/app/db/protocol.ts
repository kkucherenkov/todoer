import type {
  Catalog,
  Item,
  Mark,
  TaskChanges,
  taskDetails,
  ViewFields,
} from '@todoer/client-core';

export const CHANNEL = 'todoer';
export const LEADER_LOCK = 'todoer:leader';

export type SyncReason =
  'start' | 'write' | 'tick' | 'focus' | 'online' | 'manual';

/** Every write carries its ids from the tab, so a resend is the same write
 *  (departure 2); a create also carries the new row's `id`. */
export type Write =
  | { kind: 'add'; opId: string; id: string; text: string }
  | { kind: 'mark'; opId: string; taskId: string; mark: Mark }
  | { kind: 'edit'; opId: string; taskId: string; changes: TaskChanges }
  | {
      kind: 'move';
      opId: string;
      taskId: string;
      /** The view the card was dropped in: its id, or `all`. */
      view: string;
      statusId?: string | null;
      /** The card it now follows; null: first. Ranks only in a manual view. */
      after?: string | null;
    }
  | { kind: 'saveView'; opId: string; id: string; fields: ViewFields }
  | { kind: 'deleteView'; opId: string; id: string }
  | {
      kind: 'saveStatus';
      opId: string;
      id: string;
      name?: string;
      after?: string | null;
    }
  | { kind: 'setCompleting'; opId: string; id: string }
  | { kind: 'deleteStatus'; opId: string; id: string };

/** The view key of the built-in "All open" (departure 8). */
export const ALL = 'all';

export type Command =
  | { kind: 'signIn'; email: string; password: string }
  | { kind: 'signOut' }
  | { kind: 'sync'; reason: SyncReason }
  /** What this tab shows; null: nothing (the tab is hidden or gone). */
  | { kind: 'watch'; view: string | null; task: string | null }
  | Write;

/** One i18n key per kind (`errors.<kind>`); locales.spec.ts checks both files. */
export const FAILURE_KINDS = [
  'invalid-credentials', // login 401
  'refused', // any other refusal (429, a foreign outbox, …)
  'unreachable', // network error or timeout
  'signed-out', // the session ended
  'unavailable', // no worker answered in time
  'invalid', // the core refused the input (a UsageError)
  'unexpected',
] as const;

export type Failure = {
  kind: (typeof FAILURE_KINDS)[number];
  /** The core's own text, shown as a detail line only (departure 7). */
  detail: string;
};
/** What a mark (or a drop into or out of the completing column) did. */
export type Note = {
  marked: 'done' | 'undo';
  occurrence: string | null;
  /** A recurring task's occurrence that is current now. */
  next: string | null;
};
export type Result =
  { ok: true; note?: Note } | { ok: false; failure: Failure };

export type Topics = {
  engine: { state: 'starting' | 'ready' | 'failed'; reason: string | null };
  session: {
    state: 'restoring' | 'signed-out' | 'signed-in';
    reason: Failure['kind'] | null;
  };
  sync: {
    running: boolean;
    /** null until the first attempt; false when the server was not reached. */
    reached: boolean | null;
    lastSyncedAt: string | null;
    pending: number;
    failed: number;
    problem: string | null;
  };
  /** The placeholder's proof of sync (W3 replaces it with views). */
  summary: { tasks: number };
  catalog: Catalog;
  /** Published for every watched key; a tab keeps only its own. */
  view: {
    key: string;
    layout: string;
    sort: string;
    /** filterProblem's text, or `deleted`; then `items` is empty. */
    problem: string | null;
    items: Item[];
  };
  task: { id: string; task: ReturnType<typeof taskDetails> };
};
export type Topic = keyof Topics;

/** Every message names the build that sent it; a mismatch is a stale tab. */
type Stamped<T> = T & { build: string };

export type ToWorker = Stamped<
  | { type: 'request'; tab: string; id: number; command: Command }
  | { type: 'hello'; tab: string } // publish every topic for me
>;
export type FromWorker = Stamped<
  | { type: 'reply'; tab: string; id: number; result: Result }
  | { [T in Topic]: { type: 'publish'; topic: T; value: Topics[T] } }[Topic]
  | { type: 'ready' } // a worker (re)started: resend what is pending
  | { type: 'violation'; directive: string; blocked: string } // CSP, from inside the worker
>;

/** Leader tab → its dedicated worker, over postMessage, once. */
export type Init = { type: 'init'; build: string; hint: boolean };
/** Worker → leader tab, over postMessage: init failed. */
export type Fatal = { type: 'fatal'; reason: string };
