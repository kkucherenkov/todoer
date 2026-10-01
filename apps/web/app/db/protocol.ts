export const CHANNEL = 'todoer';
export const LEADER_LOCK = 'todoer:leader';

export type SyncReason =
  'start' | 'write' | 'tick' | 'focus' | 'online' | 'manual';

export type Command =
  | { kind: 'signIn'; email: string; password: string }
  | { kind: 'signOut' }
  | { kind: 'sync'; reason: SyncReason };

/** One i18n key per kind (`errors.<kind>`); locales.spec.ts checks both files. */
export const FAILURE_KINDS = [
  'invalid-credentials', // login 401
  'refused', // any other refusal (429, a foreign outbox, …)
  'unreachable', // network error or timeout
  'signed-out', // the session ended
  'unavailable', // no worker answered in time
  'unexpected',
] as const;

export type Failure = {
  kind: (typeof FAILURE_KINDS)[number];
  /** The core's own text, shown as a detail line only (departure 7). */
  detail: string;
};
export type Result = { ok: true } | { ok: false; failure: Failure };

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
