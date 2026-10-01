import {
  addDays,
  completingStatus,
  displayStatus,
  filterProblem,
  isIsoDate,
  matches,
  nameKey,
  parseRrule,
  taskOccurrenceId,
  taskTagId,
  type Filter,
  type FilterTask,
  type Op,
  type OpCreate,
  type OpSet,
  type Rrule,
  type StatusRow,
} from '@todoer/specs';
import type { AuthApi, TokenSource } from './auth.js';
import { expand } from './expand.js';
import {
  currentOccurrence,
  HORIZON_DAYS,
  isOccurrence,
  latestClosed,
  localDate,
  recurrenceOf,
  type Recurrence,
  type StateOf,
} from './occurrence.js';
import {
  compareIds,
  isAttached,
  labelsOf,
  liveTags,
  notDeleted,
  resolveLabels,
  winner,
} from './labels.js';
import { planMerge } from './merge.js';
import { liveTasks, overlay } from './overlay.js';
import { PROJECT, TAG, planAdd } from './parse-quick-add.js';
import {
  RefusalError,
  refusalOf,
  throwRefusals,
  UsageError,
} from './protocol.js';
import { resolveRef, shortRef } from './ref.js';
import type { Row, Store } from './store.js';
import { flush, type Transport } from './sync.js';
import { unknownCommand } from './usage.js';

export type Deps = {
  store: Store;
  send: Transport;
  now: () => Date;
  newId: () => string;
  auth: AuthApi;
  /** The CLI's own stored session: never `TODOER_TOKEN`, which is not one. */
  tokens: TokenSource;
  /** `TODOER_TOKEN` is set. */
  envToken: boolean;
  readPassword: () => Promise<string>;
};

export type Outcome = { exit: 0 | 5; stdout: string[]; stderr: string[] };

const UNREACHED =
  'the server was not reached: this answer is local, and any operation this command queued will be sent by a later command';

/**
 * Pulls `name <value>` out of argv. An option is a whole argument, never a
 * substring: `add "fix --rrule parsing"` arrives as one argument and stays
 * the title (plan C1, Review Focus 4).
 */
function takeOption(
  args: string[],
  name: string,
): { value: string | undefined; rest: string[] } {
  const at = args.indexOf(name);
  if (at === -1) return { value: undefined, rest: args };
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${name} needs a value`);
  }
  if (args.indexOf(name, at + 2) !== -1) {
    throw new UsageError(`${name} given twice`);
  }
  return { value, rest: [...args.slice(0, at), ...args.slice(at + 2)] };
}

type PlannedRecurrence = {
  fields: Record<string, string>;
  rule: Rrule | null;
  dtstart: string | null;
};

/** The recurrence fields `add` sends, checked before anything is queued
 *  (plan C design, Q9); carries the parsed rule along so `add` can also warn
 *  when it produces nothing (M5) without parsing it twice. */
function planRecurrence(
  rrule: string | undefined,
  from: string | undefined,
  today: string,
): PlannedRecurrence {
  if (rrule === undefined) {
    if (from !== undefined) throw new UsageError('--from needs --rrule');
    return { fields: {}, rule: null, dtstart: null };
  }
  const parsed = parseRrule(rrule);
  if (!parsed.ok) throw new UsageError(`--rrule: ${parsed.error}`);
  const dtstart = from ?? today;
  if (!isIsoDate(dtstart)) {
    throw new UsageError('--from must be a date, YYYY-MM-DD');
  }
  return { fields: { rrule, dtstart }, rule: parsed.rule, dtstart };
}

/**
 * `null` when the rule produces at least one occurrence within
 * `HORIZON_DAYS` of its own dtstart, otherwise the stderr note `add` should
 * give: the task is still queued (M5), but a caller who never sees it in
 * `list` deserves to know why up front rather than assume it was lost.
 */
function emptyRuleNotice(recurrence: PlannedRecurrence): string | null {
  const { rule, dtstart } = recurrence;
  if (rule === null || dtstart === null) return null;
  const has =
    expand(rule, dtstart, dtstart, addDays(dtstart, HORIZON_DAYS), 1).length >
    0;
  return has
    ? null
    : `note: this rule produces no occurrence from ${dtstart} — the task will not be listed`;
}

/** What each marking command writes into `state` (plan C design, Q4). */
const MARK = { done: 'done', skip: 'skipped', undo: 'open' } as const;
type Mark = keyof typeof MARK;

function isMark(command: string | undefined): command is Mark {
  return command === 'done' || command === 'skip' || command === 'undo';
}

/** A listed task: the row, its reference, and the date it is due (`null`
 *  for a one-off task). */
type Due = Row & {
  ref: string;
  occurrence: string | null;
  project: string | null;
  tags: string[];
  /** The status's name; `null` when the user has no statuses. */
  status: string | null;
};

/** The `sub` claim of an access token (base64url(JSON) + '.' + mac). Read, not
 *  verified: the server verifies it, this only names whose replica it is. */
function subject(token: string): string | undefined {
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString(),
    ) as { sub?: unknown };
    return typeof claims.sub === 'string' ? claims.sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The replica, cursor and outbox belong to one account: `change_seq` is
 * global, so another account's cursor would skip its rows, and queued
 * operations would be delivered to the wrong user. Signing in as someone else
 * drops the replica, but never operations nobody has delivered.
 */
function adoptAccount(store: Store, accessToken: string): void {
  const user = subject(accessToken);
  if (user === undefined) return;
  const owner = store.owner();
  if (owner !== undefined && owner !== user) {
    const { pending, failed } = store.counts();
    if (pending + failed > 0) {
      throw new RefusalError(
        `${pending + failed} queued operation(s) belong to the previous account: sign back in as it to deliver them (todoer outbox drop forgets failed ones)`,
      );
    }
    store.resetReplica();
  }
  store.setOwner(user);
}

/**
 * Every command: flush the outbox and pull first (design doc, Q5), then
 * answer from the replica with the outbox applied on top. Exit 5 whenever
 * the server was not reached (Q3). Refusals and conflicts of the command's
 * own operation are thrown; index.ts turns them into exit codes. add, done,
 * skip and undo each queue one operation through `submit`.
 */
export async function run(argv: string[], deps: Deps): Promise<Outcome> {
  const json = argv.includes('--json');
  const [command, ...rest] = argv.filter((arg) => arg !== '--json');
  const { store } = deps;
  const stderr: string[] = [];
  let synced: boolean;
  let data: unknown;
  let human: string[];

  // Neither command syncs: they only move the session.
  if (command === 'login') {
    const [email, ...extra] = rest;
    if (email === undefined || extra.length > 0) {
      throw new UsageError('login needs exactly one email');
    }
    const session = await deps.auth.login(email, await deps.readPassword());
    await store.withWriteLock(() => {
      adoptAccount(store, session.accessToken);
      store.saveAuth(session);
      return Promise.resolve();
    });
    return accountOutcome(
      store,
      json,
      { email },
      `signed in as ${email}`,
      undefined,
      deps.envToken
        ? ['TODOER_TOKEN is set and still overrides the stored session']
        : [],
    );
  }
  if (command === 'logout') {
    const all = rest.length === 1 && rest[0] === '--all';
    if (rest.length > 0 && !all)
      throw new UsageError('logout takes only --all');
    let failure: unknown;
    if (store.auth() !== undefined) {
      try {
        await revoke(deps, all);
      } catch (error) {
        failure = error;
      }
      // The caller asked to sign out: the tokens go whatever the server said.
      await store.withWriteLock(() => Promise.resolve(store.clearAuth()));
    } else if (deps.envToken) {
      stderr.push('TODOER_TOKEN is not a session the CLI can sign out');
    }
    if (failure instanceof RefusalError) {
      throw new RefusalError(`signed out locally, but ${failure.message}`);
    }
    // A server not reached is exit 5 like everywhere else; the local half is done.
    return accountOutcome(
      store,
      json,
      null,
      'signed out',
      failure === undefined
        ? undefined
        : 'signed out locally, but the server was not reached: the session stays valid there until it expires',
      stderr,
    );
  }

  if (command === 'add') {
    const rrule = takeOption(rest, '--rrule');
    const from = takeOption(rrule.rest, '--from');
    const recurrence = planRecurrence(
      rrule.value,
      from.value,
      localDate(deps.now()),
    );
    const ruleNotice = emptyRuleNotice(recurrence);
    if (ruleNotice !== null) stderr.push(ruleNotice);
    // Refuses an empty title — see planAdd.
    const { title, priority, project, tags } = planAdd(from.rest.join(' '));
    const ts = deps.now().toISOString();
    const labels = resolveLabels(
      { project, tags },
      { projects: projects(store), tags: tagRows(store) },
      deps.newId,
      ts,
    );
    if (labels.created.length > 0) {
      stderr.push(`note: created ${labels.created.join(' ')}`);
    }
    const op: OpCreate = {
      opId: deps.newId(),
      kind: 'create',
      table: 'task',
      id: deps.newId(),
      fields: {
        title,
        priority,
        rank: 'a0',
        ...(labels.projectId === null ? {} : { projectId: labels.projectId }),
        ...recurrence.fields,
      },
      ts,
    };
    const linkOps: OpCreate[] = labels.tagIds.map((tagId) => ({
      opId: deps.newId(),
      kind: 'create',
      table: 'task_tag',
      id: taskTagId(op.id, tagId),
      fields: { taskId: op.id, tagId },
      ts,
    }));
    synced = await submit(
      store,
      deps.send,
      [...labels.creates, op, ...linkOps],
      'add',
    );
    data = tasks(store).find((row) => row.id === op.id) ?? null;
    human = [title];
  } else if (command === 'list') {
    const view = takeOption(rest, '--view');
    const filters = view.rest.map((arg) => {
      if (TAG.test(arg)) return { tag: nameKey(arg) };
      if (PROJECT.test(arg)) return { project: nameKey(arg.slice(1)) };
      throw new UsageError(
        `list takes @tag and #project filters, not ${JSON.stringify(arg)}`,
      );
    });
    ({ synced } = await flush(store, deps.send));
    const today = localDate(deps.now());
    const chosen =
      view.value === undefined ? undefined : pickView(store, view.value);
    const rows = sortFor(
      chosen,
      due(store, today).filter(
        ({ row, facts }) =>
          filters.every((f) =>
            'tag' in f
              ? row.tags.some((name) => nameKey(name) === f.tag)
              : row.project !== null && nameKey(row.project) === f.project,
          ) &&
          (chosen === undefined || matches(chosen.filter, facts, today)),
      ),
    ).map(({ row }) => row);
    data = rows;
    human = rows.map((row) =>
      [
        row.ref,
        String(row.priority),
        String(row.title),
        ...(row.project === null && row.tags.length === 0
          ? []
          : [
              [
                ...(row.project === null ? [] : [`#${row.project}`]),
                ...row.tags,
              ].join(' '),
            ]),
        ...(row.occurrence === null ? [] : [row.occurrence]),
        ...(row.status === null ? [] : [row.status]),
      ].join('  '),
    );
  } else if (command === 'views') {
    ({ synced } = await flush(store, deps.send));
    const rows = notDeleted(viewRows(store)).sort(
      (a, b) => compareStrings(a.rank, b.rank) || compareIds(a, b),
    );
    data = rows;
    human = rows.map((v) => [v.name, v.layout, v.sort].map(String).join('  '));
  } else if (isMark(command)) {
    const on = takeOption(rest, '--on');
    const [ref, ...extra] = on.rest;
    if (ref === undefined || extra.length > 0) {
      throw new UsageError(`${command} needs exactly one task id or id suffix`);
    }
    // Resolved against what this client can see, before anything is sent:
    // like every write, a mark works offline.
    const all = tasks(store);
    const task = resolveRef(liveTasks(all), ref);
    const taskId = String(task.id);
    const marks = occurrences(store);
    const occurrence = pickOccurrence(
      command,
      recurrenceOf(task, parentOf(all, task)),
      on.value,
      localDate(deps.now()),
      marks,
      taskId,
    );
    // ADR 0015 callers retry: repeating a mark is a no-op, and switching
    // done and skipped goes through undo, so completedAt is never rewritten.
    const state =
      command === 'undo' ? undefined : stateOf(marks, taskId)(occurrence);
    const closed = state === 'done' || state === 'skipped' ? state : undefined;
    if (closed !== undefined && closed !== MARK[command]) {
      throw new UsageError(`already ${closed} — undo it first`);
    }
    const repeated = closed !== undefined;
    const now = deps.now().toISOString();
    const op: OpCreate = {
      opId: deps.newId(),
      kind: 'create',
      table: 'task_occurrence',
      id: taskOccurrenceId(taskId, occurrence),
      fields: {
        taskId,
        occurrence,
        state: MARK[command],
        completedAt: command === 'done' ? now : null,
      },
      ts: now,
    };
    synced = repeated
      ? (await flush(store, deps.send)).synced
      : await submit(
          store,
          deps.send,
          () => [
            ...statusOps(command, task, statusRows(store), deps.newId, now),
            op,
          ],
          command,
        );
    const marked = occurrences(store).find((row) => row.id === op.id) ?? null;
    data = marked;
    // I3: `submit` settled this op, but the row it settled to is not the
    // state this command wrote — a newer change from elsewhere won under
    // per-field LWW. --json already carries the real state; a plain caller
    // gets no other signal that its mark did not stick.
    if (synced && marked !== null && marked.state !== MARK[command]) {
      stderr.push(
        `note: the server kept '${String(marked.state)}' — a later change from another device decided this occurrence`,
      );
    }
    human = [
      [
        repeated ? `already ${closed}` : command,
        String(task.title),
        ...(occurrence === null ? [] : [occurrence]),
      ].join('  '),
    ];
  } else if (command === 'outbox' && rest[0] === 'drop') {
    const ids = rest.slice(1);
    if (ids.length === 0) {
      throw new UsageError('outbox drop needs at least one operation id');
    }
    ({ synced } = await flush(store, deps.send));
    store.drop(ids);
    data = ids;
    human = ids.map((id) => `dropped ${id}`);
  } else if (command === 'outbox' && rest.length === 0) {
    ({ synced } = await flush(store, deps.send));
    // Read again below: the cleanup and merge may change what it lists.
    ({ data, human } = listOutbox(store));
  } else {
    throw unknownCommand(
      command === 'outbox' ? `outbox ${rest.join(' ')}` : command,
    );
  }

  // Every pull may bring a duplicate name another device created offline
  // (quick-add design, Q9). The merge is queued, not sent: the next command
  // delivers it, like any other queued operation.
  if (synced) {
    // A failed delete, or a failed `set statusId`, on a row that is already a
    // tombstone is moot. Two clients merging the same duplicates send the
    // same delete, and the second gets `conflict`; a `done` queued offline on
    // a task another device deleted has its `set statusId` refused ("row is
    // deleted") while the mark itself lands. Left alone either entry would
    // sit as failed forever. Any other failed set on a tombstone stays: it is
    // an edit the user made, and its failure is theirs to see.
    // A row gone from the replica (after a 410 and a prune) leaves its failed
    // entry in place: there is no tombstone to prove it moot.
    for (const entry of store.entries()) {
      const { op } = entry;
      if (entry.status !== 'failed') continue;
      const moot =
        op.kind === 'delete' || (op.kind === 'set' && op.field === 'statusId');
      if (!moot) continue;
      const gone = store
        .rows(op.table)
        .some((row) => row.id === op.id && row.deletedAt !== null);
      if (gone) store.remove(entry.opId);
    }
    const { ops, merged } = planMerge(
      {
        tasks: tasks(store),
        projects: projects(store),
        tags: tagRows(store),
        links: links(store),
        statuses: statusRows(store),
        views: viewRows(store),
      },
      deps.newId,
      deps.now().toISOString(),
    );
    if (ops.length > 0) {
      store.transaction(() => {
        for (const op of ops) store.enqueue(op);
      });
      for (const name of merged) {
        stderr.push(
          `note: merging duplicate ${name} — sent with the next command`,
        );
      }
    }
  }

  if (synced && command === 'outbox' && rest.length === 0) {
    ({ data, human } = listOutbox(store));
  }
  const outbox = store.counts();
  if (!synced) stderr.push(UNREACHED);
  if (outbox.failed > 0) {
    stderr.push(
      `${outbox.failed} queued operation(s) failed — see \`todoer outbox\``,
    );
  }
  return {
    exit: synced ? 0 : 5,
    stdout: json ? [JSON.stringify({ data, synced, outbox })] : human,
    stderr,
  };
}

/**
 * Signs the stored session out on the server. A token this close to expiry is
 * refreshed first, and a 401 renews once and retries once: `POST /auth/logout`
 * is behind the access guard, and an expired token would leave the session
 * alive there. A refused refresh means the session is dead already.
 */
async function revoke(deps: Deps, all: boolean): Promise<void> {
  const { store, tokens } = deps;
  const ended = (error: unknown) => {
    if (error instanceof RefusalError) return null;
    throw error;
  };
  const send = (bearer: string) => {
    const auth = store.auth();
    return auth === undefined
      ? Promise.resolve(undefined)
      : deps.auth.logout(
          bearer,
          all ? { all: true } : { refreshToken: auth.refreshToken },
        );
  };
  const bearer = await tokens.current().catch(ended);
  if (bearer === null || (await send(bearer)) !== 'unauthorized') return;
  const renewed = await tokens.renew(bearer).catch(ended);
  if (renewed === null) return;
  if ((await send(renewed)) === 'unauthorized') {
    throw new RefusalError('logout refused: 401');
  }
}

function accountOutcome(
  store: Store,
  json: boolean,
  data: unknown,
  human: string,
  unreached?: string,
  notes: string[] = [],
): Outcome {
  const synced = unreached === undefined;
  return {
    exit: synced ? 0 : 5,
    stdout: [
      json ? JSON.stringify({ data, synced, outbox: store.counts() }) : human,
    ],
    stderr: synced ? notes : [...notes, unreached],
  };
}

function listOutbox(store: Store): { data: unknown; human: string[] } {
  const entries = store.entries();
  return {
    data: entries,
    human: entries.map((e) =>
      [e.status, e.opId, `${e.op.kind} ${e.op.table}`, e.reason ?? '']
        .join('  ')
        .trimEnd(),
    ),
  };
}

/**
 * Queues the operations the running command minted, in one transaction and in
 * order, and sends them. A builder is called inside that transaction, for ops
 * that depend on rows a parallel invocation may be writing. The ops are
 * stored before they are sent, so every attempt carries their ids (ADR 0015
 * §4). Every one counts as the command's own, so a refusal of any of them is
 * the command's exit 1 (4 for a conflict), reporting every operation's fate.
 * Returns whether the server has all of them.
 */
async function submit(
  store: Store,
  send: Transport,
  build: Op[] | (() => Op[]),
  command: string,
): Promise<boolean> {
  const ops = store.transaction(() => {
    const queued = typeof build === 'function' ? build() : build;
    for (const op of queued) store.enqueue(op);
    return queued;
  });
  const opIds = ops.map((op) => op.opId);
  const flushed = await flushOwn(store, send, opIds, command);
  const outcomes = ops.map((op) => {
    // Evaluated unconditionally, never short-circuited on `flushed.synced`:
    // a batch-refused own op is removed from the outbox (I1) even when the
    // follow-up pull that reports it is itself unreached, and that
    // rejection must still throw rather than be reported as "queued".
    const result = flushed.results.find((r) => r.opId === op.opId);
    const reported = refusalOf(result);
    if (reported !== undefined) return { op, outcome: reported };
    if (result !== undefined) return { op, outcome: 'applied' as const };
    if (!flushed.synced) return { op, outcome: 'queued' as const };
    // A parallel invocation may have sent it between the enqueue and this
    // flush's read of the outbox; its entry says what became of it.
    const entry = store.entry(op.opId);
    if (entry === undefined) return { op, outcome: 'applied' as const };
    if (entry.status === 'failed') {
      store.remove(op.opId);
      return {
        op,
        outcome: {
          kind: 'rejected' as const,
          reason: entry.reason ?? 'the server refused this operation',
        },
      };
    }
    return { op, outcome: 'queued' as const };
  });
  throwRefusals(outcomes);
  return flushed.synced && outcomes.every((o) => o.outcome === 'applied');
}

/**
 * A request-level refusal (401, 403, …) leaves the command's operations
 * queued. Said so in the error, because "refused" alone reads as "nothing
 * happened" and a caller who then repeats the command queues it twice.
 */
async function flushOwn(
  store: Store,
  send: Transport,
  opIds: string[],
  command: string,
) {
  try {
    return await flush(store, send, new Set(opIds));
  } catch (error) {
    if (
      error instanceof RefusalError &&
      opIds.some((opId) => store.entry(opId)?.status === 'pending')
    ) {
      const which =
        opIds.length === 1
          ? `operation ${opIds.join('')} is`
          : `operations ${opIds.join(', ')} are`;
      throw new RefusalError(
        `${error.message} — this command's ${which} queued and will be sent once the request is accepted — do not run ${command} again for ${opIds.length === 1 ? 'it' : 'them'}`,
      );
    }
    throw error;
  }
}

function tasks(store: Store): Row[] {
  return overlay('task', store.rows('task'), store.pending());
}

function projects(store: Store): Row[] {
  return overlay('project', store.rows('project'), store.pending());
}

function tagRows(store: Store): Row[] {
  return overlay('tag', store.rows('tag'), store.pending());
}

function statusRows(store: Store): Row[] {
  return overlay('status', store.rows('status'), store.pending());
}

function viewRows(store: Store): Row[] {
  return overlay('view', store.rows('view'), store.pending());
}

function links(store: Store): Row[] {
  return overlay('task_tag', store.rows('task_tag'), store.pending());
}

function occurrences(store: Store): Row[] {
  return overlay(
    'task_occurrence',
    store.rows('task_occurrence'),
    store.pending(),
  );
}

function parentOf(all: Row[], task: Row): Row | undefined {
  return typeof task.parentId === 'string'
    ? all.find((row) => row.id === task.parentId)
    : undefined;
}

/**
 * One task's occurrence states, from `state` alone ("Notes for C1"). Only
 * rows naming this task are read, so a task occurrence whose task is
 * tombstoned or absent never affects anything (FR-009).
 */
// ponytail: a linear scan per lookup; index by task id if lists grow long.
function stateOf(marks: Row[], taskId: string): StateOf {
  return (occurrence) =>
    marks.find(
      (row) => row.taskId === taskId && (row.occurrence ?? null) === occurrence,
    )?.state;
}

function setTask(
  task: Row,
  field: string,
  value: unknown,
  newId: () => string,
  ts: string,
): OpSet {
  return {
    opId: newId(),
    kind: 'set',
    table: 'task',
    id: String(task.id),
    field,
    value,
    ts,
  };
}

/** The statuses as `displayStatus` and `completingStatus` read them. */
function statusFacts(statuses: Row[]): StatusRow[] {
  return notDeleted(statuses).map((s) => ({
    id: String(s.id),
    rank: String(s.rank),
    completing: s.completing === true,
  }));
}

/**
 * The statusId writes that keep a board aligned with a mark (views design,
 * Q7): done moves the task to the completing status, seeding Inbox, Doing,
 * Done first when the user has none (plan V1, departure 1); undo clears it
 * (departure 2); skip leaves it (departure 3).
 */
function statusOps(
  command: Mark,
  task: Row,
  statuses: Row[],
  newId: () => string,
  ts: string,
): Op[] {
  if (command === 'skip') return [];
  if (command === 'undo') {
    return task.statusId === null || task.statusId === undefined
      ? []
      : [setTask(task, 'statusId', null, newId, ts)];
  }
  const live = statusFacts(statuses);
  const seeded: OpCreate[] =
    live.length > 0
      ? []
      : [
          { name: 'Inbox', rank: 'a0', completing: false },
          { name: 'Doing', rank: 'a1', completing: false },
          { name: 'Done', rank: 'a2', completing: true },
        ].map((fields) => ({
          opId: newId(),
          kind: 'create',
          table: 'status',
          id: newId(),
          fields,
          ts,
        }));
  const target = completingStatus([
    ...live,
    ...seeded.map((op) => ({
      id: op.id,
      rank: String(op.fields.rank),
      completing: op.fields.completing === true,
    })),
  ]);
  if (target === undefined || task.statusId === target) return seeded;
  return [...seeded, setTask(task, 'statusId', target, newId, ts)];
}

/** A task with the facts a view's filter reads. */
type Listed = { row: Due; facts: FilterTask };

/** Each live task once, at its current occurrence (plan C design, Q11). */
function due(store: Store, today: string): Listed[] {
  const all = tasks(store);
  const marks = occurrences(store);
  const labelRows = {
    projects: projects(store),
    tags: tagRows(store),
    links: links(store),
  };
  const live = notDeleted(statusRows(store));
  const facts = statusFacts(live);
  const names = new Map(live.map((s) => [String(s.id), String(s.name)]));
  const liveTagIds = new Set(liveTags(labelRows.tags).map((t) => String(t.id)));
  return liveTasks(all).flatMap((task) => {
    const taskId = String(task.id);
    const recurrence = recurrenceOf(task, parentOf(all, task));
    const current = currentOccurrence(
      recurrence,
      stateOf(marks, taskId),
      today,
    );
    if (current === null) return [];
    const statusId =
      displayStatus(
        typeof task.statusId === 'string' ? task.statusId : null,
        facts,
        false,
      ) ?? null;
    const row = {
      ...task,
      ref: shortRef(taskId),
      occurrence: current.occurrence,
      ...labelsOf(task, labelRows),
      status: statusId === null ? null : (names.get(statusId) ?? null),
    };
    return [
      {
        row,
        facts: {
          tagIds: labelRows.links
            .filter(
              (l) =>
                l.taskId === task.id &&
                isAttached(l) &&
                liveTagIds.has(String(l.tagId)),
            )
            .map((l) => String(l.tagId)),
          projectId: row.project === null ? null : String(task.projectId),
          statusId,
          priority: Number(task.priority),
          scheduledOn:
            recurrence === null
              ? typeof task.scheduledOn === 'string'
                ? task.scheduledOn
                : null
              : current.occurrence,
          dueOn: typeof task.dueOn === 'string' ? task.dueOn : null,
          recurring: recurrence !== null,
        },
      },
    ];
  });
}

type ChosenView = { sort: string; filter: Filter };

/** The live view `--view` names: by name key, the lowest id among duplicates.
 *  Never a silent "all tasks": an unknown name or a filter this client cannot
 *  evaluate is an error. */
function pickView(store: Store, name: string): ChosenView {
  const key = nameKey(name);
  const found = winner(
    notDeleted(viewRows(store)).filter(
      (v) => typeof v.name === 'string' && nameKey(v.name) === key,
    ),
  );
  if (found === undefined) throw new UsageError(`no view named ${name}`);
  const problem = filterProblem(found.filter);
  if (problem !== null) {
    throw new RefusalError(`view ${name} has an invalid filter: ${problem}`);
  }
  return { sort: String(found.sort), filter: found.filter as Filter };
}

function compareStrings(a: unknown, b: unknown): number {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** The view's order (plan V1, Global Constraints); without a view, `list`
 *  keeps its own. Every key ends in rank, then id. */
function sortFor(view: ChosenView | undefined, rows: Listed[]): Listed[] {
  if (view === undefined) return rows;
  const key = (l: Listed): string | number | null =>
    view.sort === 'priority'
      ? -l.facts.priority
      : view.sort === 'due'
        ? l.facts.dueOn
        : view.sort === 'scheduled'
          ? l.facts.scheduledOn
          : 0;
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : 1;
    }
    return compareStrings(a.row.rank, b.row.rank) || compareIds(a.row, b.row);
  });
}

/**
 * The date a mark applies to. `--on` names one the rule produces; otherwise
 * `done`/`skip` take the current occurrence and `undo` the latest closed one
 * (plan C1, departure 1). Every refusal is a usage error: nothing is queued.
 */
function pickOccurrence(
  command: Mark,
  recurrence: Recurrence | null,
  on: string | undefined,
  today: string,
  marks: Row[],
  taskId: string,
): string | null {
  if (recurrence === null) {
    if (on !== undefined) {
      throw new UsageError('--on is only for recurring tasks');
    }
    if (command === 'undo' && latestClosed(marks, taskId) === null) {
      throw new UsageError('nothing to undo: this task is not done or skipped');
    }
    return null;
  }
  if (on !== undefined) {
    if (!isIsoDate(on)) throw new UsageError('--on must be a date, YYYY-MM-DD');
    if (!isOccurrence(recurrence, on)) {
      throw new UsageError(`${on} is not an occurrence of this task`);
    }
    return on;
  }
  if (command === 'undo') {
    const last = latestClosed(marks, taskId);
    if (last === null) {
      throw new UsageError(
        'nothing to undo: no occurrence of this task is done or skipped',
      );
    }
    return last.occurrence;
  }
  const current = currentOccurrence(recurrence, stateOf(marks, taskId), today);
  if (current === null) {
    throw new UsageError(
      'this task has no open occurrence left — name one with --on',
    );
  }
  return current.occurrence;
}
