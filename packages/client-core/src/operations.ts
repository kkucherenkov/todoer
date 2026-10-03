import {
  addDays,
  completingStatus,
  displayStatus,
  filterProblem,
  isIsoDate,
  matches,
  nameKey,
  taskOccurrenceId,
  taskTagId,
  type Filter,
  type FilterTask,
  type Op,
  type OpCreate,
  type OpSet,
  type StatusRow,
} from '@todoer/specs';
import {
  currentOccurrence,
  isOccurrence,
  latestClosed,
  localDate,
  recurrenceOf,
  ruleProblem,
  type Recurrence,
  type StateOf,
} from './occurrence.js';
import {
  compareIds,
  labelsOf,
  liveTags,
  notDeleted,
  isAttached,
  liveProjects,
  winner,
  resolveLabels,
} from './labels.js';
import { expand } from './expand.js';
import { planMerge } from './merge.js';
import { rankBetween, rankWrites, type Ranked } from './rank.js';
import { liveTasks, overlay } from './overlay.js';
import { planAdd } from './parse-quick-add.js';
import { resolveRef, shortRef } from './ref.js';
import { flush, type Transport } from './sync.js';
import {
  RefusalError,
  UsageError,
  refusalOf,
  throwRefusals,
} from './protocol.js';
import type { Row, Store } from './store.js';

/** What every operation needs; the CLI's Deps is a superset. */
export type Core = {
  store: Store;
  send: Transport;
  now: () => Date;
  newId: () => string;
};

/** A label filter by name key: `list @Work` → { tag: 'work' }. */
export type LabelFilter = { tag: string } | { project: string };

/** What each marking command writes into `state` (plan C design, Q4). */
export const MARK = { done: 'done', skip: 'skipped', undo: 'open' } as const;
export type Mark = keyof typeof MARK;

export function isMark(command: string | undefined): command is Mark {
  return command === 'done' || command === 'skip' || command === 'undo';
}

/** A listed task: the row, its reference, and the date it is due (`null`
 *  for a one-off task). */
export type Due = Row & {
  ref: string;
  occurrence: string | null;
  project: string | null;
  tags: string[];
  /** The status's name; `null` when the user has no statuses. */
  status: string | null;
};

/**
 * Queues the operations the running command minted, in one transaction and in
 * order, and sends them. A builder is called inside that transaction, for ops
 * that depend on rows a parallel invocation may be writing. The ops are
 * stored before they are sent, so every attempt carries their ids (ADR 0015
 * §4). Every one counts as the command's own, so a refusal of any of them is
 * the command's exit 1 (4 for a conflict), reporting every operation's fate.
 * Returns whether the server has all of them.
 *
 * With `key`, the command is the unit of idempotence (plan W3, departure 2):
 * the claim is written in the same transaction as the enqueue, and a key
 * already claimed queues nothing, so a resend only flushes.
 */
export async function submit(
  store: Store,
  send: Transport,
  build: Op[] | (() => Op[]),
  command: string,
  key?: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const ops = store.transaction(() => {
    if (key !== undefined) {
      if (store.seen(key)) return [];
      store.claim(key, nowMs);
    }
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

function setRow(
  table: 'task' | 'view' | 'status',
  row: Row,
  field: string,
  value: unknown,
  newId: () => string,
  ts: string,
): OpSet {
  return {
    opId: newId(),
    kind: 'set',
    table,
    id: String(row.id),
    field,
    value,
    ts,
  };
}

const setTask = (
  task: Row,
  field: string,
  value: unknown,
  newId: () => string,
  ts: string,
): OpSet => setRow('task', task, field, value, newId, ts);

/** The statuses as `displayStatus` and `completingStatus` read them. */
function statusFacts(statuses: Row[]): StatusRow[] {
  return notDeleted(statuses).map((s) => ({
    id: String(s.id),
    rank: String(s.rank),
    completing: s.completing === true,
  }));
}

/** The Inbox, Doing, Done creates (views Q9), shared with statusOps. */
export function seedOps(newId: () => string, ts: string): OpCreate[] {
  return [
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
  const seeded = live.length > 0 ? [] : seedOps(newId, ts);
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
type Listed = { row: Due; facts: FilterTask; closed: boolean };

/**
 * Each live task once, at its current occurrence (plan C design, Q11). With
 * `closedSince`, also the one-off tasks closed on or after that date, each in
 * the completing column (`null`: however long ago). A closed mark without a
 * `fieldTs` is still in the outbox and counts as now.
 */
function due(
  store: Store,
  today: string,
  closedSince?: string | null,
): Listed[] {
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
    const closedMark =
      current === null && recurrence === null && closedSince !== undefined
        ? marks.find(
            (m) => m.taskId === taskId && (m.occurrence ?? null) === null,
          )
        : undefined;
    const closedAt = (
      closedMark?.fieldTs as Record<string, string> | undefined
    )?.state?.slice(0, 10);
    // The drawer (`closedSince` null) reads any live task, an ended series too.
    if (
      current === null &&
      closedSince !== null &&
      (closedMark === undefined ||
        (typeof closedSince === 'string' &&
          closedAt !== undefined &&
          closedAt < closedSince))
    ) {
      return [];
    }
    const closed = current === null;
    const statusId =
      displayStatus(
        typeof task.statusId === 'string' ? task.statusId : null,
        facts,
        closed,
      ) ?? null;
    const row = {
      ...task,
      ref: shortRef(taskId),
      occurrence: current?.occurrence ?? null,
      ...labelsOf(task, labelRows),
      status: statusId === null ? null : (names.get(statusId) ?? null),
    };
    return [
      {
        row,
        closed,
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
              : (current?.occurrence ?? null),
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
function sortFor(sort: string | undefined, rows: Listed[]): Listed[] {
  if (sort === undefined) return rows;
  const key = (l: Listed): string | number | null =>
    sort === 'priority'
      ? -l.facts.priority
      : sort === 'due'
        ? l.facts.dueOn
        : sort === 'scheduled'
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

/** Minted in the tab: the command's first op id (and replay key), and for a
 *  create the new row's id. */
export type Minted = { opId: string; id?: string };

/** `add`: quick-add text plus already-validated recurrence fields; with
 *  `parentId`, a subtask of that task (no rule; the parent's project unless
 *  the text names one). */
export async function add(
  core: Core,
  text: string,
  recurrence: Record<string, string>,
  minted?: Minted,
  parentId?: string,
): Promise<{
  synced: boolean;
  title: string;
  created: string[];
  task: Row | null;
}> {
  const { store, send } = core;
  if (minted !== undefined && store.seen(minted.opId)) {
    const task = tasks(store).find((row) => row.id === minted.id) ?? null;
    const { synced } = await flush(store, send);
    return {
      synced,
      title: typeof task?.title === 'string' ? task.title : '',
      created: [],
      task,
    };
  }
  let parent: Row | undefined;
  if (parentId !== undefined) {
    if (Object.keys(recurrence).length > 0) {
      throw new UsageError('a subtask repeats with its parent');
    }
    parent = liveTask(tasks(store), parentId);
    if (typeof parent.parentId === 'string') {
      throw new UsageError('a subtask cannot have subtasks');
    }
  }
  // Refuses an empty title — see planAdd.
  const { title, priority, project, tags } = planAdd(text);
  const ts = core.now().toISOString();
  const labels = resolveLabels(
    { project, tags },
    { projects: projects(store), tags: tagRows(store) },
    core.newId,
    ts,
  );
  const projectId =
    labels.projectId ??
    (typeof parent?.projectId === 'string' ? parent.projectId : null);
  const op: OpCreate = {
    opId: minted?.opId ?? core.newId(),
    kind: 'create',
    table: 'task',
    id: minted?.id ?? core.newId(),
    fields: {
      title,
      priority,
      rank: 'a0',
      ...(parentId === undefined ? {} : { parentId }),
      ...(projectId === null || projectId === undefined ? {} : { projectId }),
      ...recurrence,
    },
    ts,
  };
  const linkOps: OpCreate[] = labels.tagIds.map((tagId) => ({
    opId: core.newId(),
    kind: 'create',
    table: 'task_tag',
    id: taskTagId(op.id, tagId),
    fields: { taskId: op.id, tagId },
    ts,
  }));
  const synced = await submit(
    store,
    send,
    [...labels.creates, op, ...linkOps],
    'add',
    minted?.opId,
    core.now().getTime(),
  );
  const task = tasks(store).find((row) => row.id === op.id) ?? null;
  return { synced, title, created: labels.created, task };
}

/**
 * What a mark writes, validated: the occurrence it applies to, whether that
 * is already closed, the occurrence op and the statusId writes that go with
 * it. Shared by `mark` and `moveTask`, so there is one path to `done`.
 */
function planMark(
  core: Core,
  command: Mark,
  task: Row,
  all: Row[],
  on: string | undefined,
  opId: string | undefined,
) {
  const { store } = core;
  const taskId = String(task.id);
  const marks = occurrences(store);
  const occurrence = pickOccurrence(
    command,
    recurrenceOf(task, parentOf(all, task)),
    on,
    localDate(core.now()),
    marks,
    taskId,
  );
  // ADR 0015 callers retry: repeating a mark is a no-op, and switching
  // done and skipped goes through undo, so completedAt is never rewritten.
  const state =
    command === 'undo' ? undefined : stateOf(marks, taskId)(occurrence);
  const closed: 'done' | 'skipped' | undefined =
    state === 'done' || state === 'skipped' ? state : undefined;
  if (closed !== undefined && closed !== MARK[command]) {
    throw new UsageError(`already ${closed} — undo it first`);
  }
  const now = core.now().toISOString();
  const op: OpCreate = {
    opId: opId ?? core.newId(),
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
  return {
    occurrence,
    closed,
    op,
    statusWrites: (): Op[] =>
      statusOps(command, task, statusRows(store), core.newId, now),
  };
}

/** done / skip / undo on the task `ref` names, at `on` or the default occurrence. */
export async function mark(
  core: Core,
  command: Mark,
  ref: string,
  on: string | undefined,
  minted?: Minted,
): Promise<{
  synced: boolean;
  task: Row;
  occurrence: string | null;
  closed: 'done' | 'skipped' | undefined;
  marked: Row | null;
}> {
  const { store, send } = core;
  // Resolved against what this client can see, before anything is sent:
  // like every write, a mark works offline.
  const all = tasks(store);
  if (minted !== undefined && store.seen(minted.opId)) {
    // Before resolving the ref and pickOccurrence: the task may be deleted
    // since, and an undo that already landed has nothing left to undo. What
    // can be read back is the op if it is still queued.
    let task: Row = { id: ref };
    try {
      task = resolveRef(all, ref);
    } catch {
      // pruned: the resend only flushes, the caller keeps its own ref
    }
    const queued = store.entry(minted.opId)?.op;
    const { synced } = await flush(store, send);
    return {
      synced,
      task,
      occurrence:
        queued?.kind === 'create'
          ? ((queued.fields.occurrence as string | null) ?? null)
          : null,
      closed: undefined,
      marked:
        queued === undefined
          ? null
          : (occurrences(store).find((row) => row.id === queued.id) ?? null),
    };
  }
  const task = resolveRef(liveTasks(all), ref);
  const plan = planMark(core, command, task, all, on, minted?.opId);
  const { occurrence, closed, op } = plan;
  const synced =
    closed !== undefined
      ? (await flush(store, send)).synced
      : await submit(
          store,
          send,
          () => [...plan.statusWrites(), op],
          command,
          minted?.opId,
          core.now().getTime(),
        );
  const marked = occurrences(store).find((row) => row.id === op.id) ?? null;
  return { synced, task, occurrence, closed, marked };
}

export type TaskChanges = Partial<{
  title: string;
  notes: string | null;
  priority: number;
  scheduledOn: string | null;
  dueOn: string | null;
  project: string | null;
  tags: string[];
}>;

/** The first op carries the command's minted id (plan W3, departure 2). */
function withFirstId(ops: Op[], opId: string): Op[] {
  const [first, ...rest] = ops;
  return first === undefined ? ops : [{ ...first, opId }, ...rest];
}

const isClosed = (state: unknown) => state === 'done' || state === 'skipped';

function liveTask(all: Row[], id: string): Row {
  const task = liveTasks(all).find((row) => row.id === id);
  if (task === undefined) throw new UsageError(`no task ${id}`);
  return task;
}

function requiredName(name: string, what: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new UsageError(`${what} must not be empty`);
  return trimmed;
}

/**
 * One `set` per changed field (plus label creates and links), one batch.
 * Replay-safe: a seen `minted.opId` only flushes, before any validation.
 */
export async function editTask(
  core: Core,
  minted: Minted,
  taskId: string,
  changes: TaskChanges,
): Promise<{ synced: boolean }> {
  const { store, send } = core;
  if (store.seen(minted.opId)) {
    return { synced: (await flush(store, send)).synced };
  }
  const all = tasks(store);
  const task = liveTask(all, taskId);
  const ts = core.now().toISOString();
  const fields: [string, unknown][] = [];
  if (changes.title !== undefined) {
    fields.push(['title', requiredName(changes.title, 'title')]);
  }
  if (changes.notes !== undefined) {
    fields.push(['notes', changes.notes === '' ? null : changes.notes]);
  }
  if (changes.priority !== undefined) {
    if (![0, 1, 2, 3, 4].includes(changes.priority)) {
      throw new UsageError('priority must be 0 to 4');
    }
    fields.push(['priority', changes.priority]);
  }
  for (const key of ['scheduledOn', 'dueOn'] as const) {
    const value = changes[key];
    if (value === undefined) continue;
    if (value !== null && !isIsoDate(value)) {
      throw new UsageError(`${key} must be a date, YYYY-MM-DD`);
    }
    if (
      key === 'scheduledOn' &&
      value !== null &&
      recurrenceOf(task, parentOf(all, task)) !== null
    ) {
      throw new UsageError('a recurring task is scheduled by its rule');
    }
    fields.push([key, value]);
  }
  const rows = { projects: projects(store), tags: tagRows(store) };
  const creates: OpCreate[] = [];
  if (changes.project !== undefined) {
    if (changes.project === null) {
      fields.push(['projectId', null]);
    } else {
      const labels = resolveLabels(
        { project: requiredName(changes.project, 'project'), tags: [] },
        rows,
        core.newId,
        ts,
      );
      creates.push(...labels.creates);
      fields.push(['projectId', labels.projectId]);
    }
  }
  const linkOps: Op[] = [];
  if (changes.tags !== undefined) {
    const labels = resolveLabels(
      {
        project: undefined,
        tags: changes.tags.map((name) => requiredName(name, 'tag')),
      },
      rows,
      core.newId,
      ts,
    );
    creates.push(...labels.creates);
    const mine = links(store).filter((link) => link.taskId === taskId);
    const attached = new Set(
      mine.filter(isAttached).map((link) => String(link.tagId)),
    );
    const wanted = new Set(labels.tagIds);
    const attach = (id: string, value: boolean): Op => ({
      opId: core.newId(),
      kind: 'set',
      table: 'task_tag',
      id,
      field: 'attached',
      value,
      ts,
    });
    for (const tagId of wanted) {
      if (attached.has(tagId)) continue;
      const id = taskTagId(taskId, tagId);
      const detached = mine.some(
        (link) => link.id === id && link.deletedAt === null,
      );
      linkOps.push(
        detached
          ? attach(id, true)
          : {
              opId: core.newId(),
              kind: 'create',
              table: 'task_tag',
              id,
              fields: { taskId, tagId },
              ts,
            },
      );
    }
    for (const link of mine) {
      if (isAttached(link) && !wanted.has(String(link.tagId))) {
        linkOps.push(attach(String(link.id), false));
      }
    }
  }
  const setOps = fields
    .filter(([field, value]) => (task[field] ?? null) !== value)
    .map(([field, value]) => setTask(task, field, value, core.newId, ts));
  const ops = withFirstId([...creates, ...setOps, ...linkOps], minted.opId);
  return {
    synced: await submit(
      store,
      send,
      ops,
      'edit',
      minted.opId,
      core.now().getTime(),
    ),
  };
}

/**
 * A card moved (views Q5, Q7): into the completing status is `done` through
 * mark's path (current occurrence, statusOps, seeding); out of it, for a
 * closed task, is `undo` plus one `set statusId` to the target; between other
 * statuses one `set statusId`. `ranks` are written too. `statusId` undefined:
 * a reorder only. A user with no statuses has nothing to name but the column
 * `mark done` would seed, so any `statusId` then means completing.
 */
export async function moveTask(
  core: Core,
  minted: Minted,
  taskId: string,
  move: { statusId?: string | null; ranks?: Ranked[] },
): Promise<{
  synced: boolean;
  marked: 'done' | 'undo' | null;
  occurrence: string | null;
}> {
  const { store, send } = core;
  if (store.seen(minted.opId)) {
    const { synced } = await flush(store, send);
    return { synced, marked: null, occurrence: null };
  }
  const all = tasks(store);
  const task = liveTask(all, taskId);
  const { statusId } = move;
  const live = statusFacts(statusRows(store));
  if (
    statusId !== undefined &&
    statusId !== null &&
    live.length > 0 &&
    !live.some((s) => s.id === statusId)
  ) {
    throw new UsageError(`no status ${statusId}`);
  }
  const intoDone =
    statusId !== undefined &&
    statusId !== null &&
    (live.length === 0 || statusId === completingStatus(live));
  // Already closed (done or skipped), the card's column is all that moves.
  const closedOneOff =
    recurrenceOf(task, parentOf(all, task)) === null &&
    isClosed(stateOf(occurrences(store), taskId)(null));
  const reopen = statusId !== undefined && !intoDone && closedOneOff;
  const plan =
    (intoDone && !closedOneOff) || reopen
      ? planMark(
          core,
          intoDone ? 'done' : 'undo',
          task,
          all,
          undefined,
          minted.opId,
        )
      : undefined;
  const ts = core.now().toISOString();
  const build = (): Op[] => {
    const ops: Op[] = [];
    if (intoDone) {
      if (plan !== undefined) ops.push(...plan.statusWrites(), plan.op);
    } else if (statusId !== undefined) {
      if (plan !== undefined) ops.push(plan.op);
      if ((task.statusId ?? null) !== statusId) {
        ops.push(setTask(task, 'statusId', statusId, core.newId, ts));
      }
    }
    for (const { id, rank } of move.ranks ?? []) {
      ops.push(setTask({ id }, 'rank', rank, core.newId, ts));
    }
    return plan === undefined ? withFirstId(ops, minted.opId) : ops;
  };
  const synced = await submit(
    store,
    send,
    build,
    'move',
    minted.opId,
    core.now().getTime(),
  );
  return {
    synced,
    marked:
      plan === undefined || plan.closed !== undefined
        ? null
        : intoDone
          ? 'done'
          : 'undo',
    occurrence: plan?.occurrence ?? null,
  };
}

/** Each live task once at its current occurrence, label-filtered, then the
 *  named view's filter and sort. Reads only; the caller flushes first. */
export function listTasks(
  store: Store,
  today: string,
  filters: LabelFilter[],
  view: string | undefined,
): Due[] {
  const chosen = view === undefined ? undefined : pickView(store, view);
  return sortFor(
    chosen?.sort,
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
}

/** Live views by rank, then id. */
export function listViews(store: Store): Row[] {
  return notDeleted(viewRows(store)).sort(
    (a, b) => compareStrings(a.rank, b.rank) || compareIds(a, b),
  );
}

/** A view as the reads need it: a stored row or the built-in "All open". */
export type ViewSpec = { filter: unknown; sort: string; layout: string };
export const ALL_OPEN: ViewSpec = {
  filter: { and: [] },
  sort: 'manual',
  layout: 'list',
};

/** A listed task with what a screen shows: its column (`displayStatus`) and
 *  whether its occurrence is closed (only ever true on a board). */
export type Item = Due & {
  column: string | null;
  closed: boolean;
  /** The parent's title for a subtask; null for a top-level task. */
  parentTitle: string | null;
};

/** `titles`: the live tasks' titles by id. */
function itemOf(titles: Map<string, string>) {
  return ({ row, facts, closed }: Listed): Item => ({
    ...row,
    column: facts.statusId,
    closed,
    parentTitle:
      typeof row.parentId === 'string'
        ? (titles.get(row.parentId) ?? null)
        : null,
  });
}

const titlesOf = (store: Store) =>
  new Map(liveTasks(tasks(store)).map((t) => [String(t.id), String(t.title)]));

function selected(
  store: Store,
  today: string,
  view: ViewSpec,
  closedSince?: string,
): Item[] {
  const problem = filterProblem(view.filter);
  if (problem !== null) {
    throw new RefusalError(`view has an invalid filter: ${problem}`);
  }
  return sortFor(
    view.sort,
    due(store, today, closedSince).filter(({ facts }) =>
      matches(view.filter as Filter, facts, today),
    ),
  ).map(itemOf(titlesOf(store)));
}

/** The open tasks a list view shows, filtered and sorted (the CLI's facts). */
export function viewTasks(store: Store, today: string, view: ViewSpec): Item[] {
  return selected(store, today, view);
}

/** viewTasks plus one-off tasks closed within `closedDays` (departure 6),
 *  each in the completing column. */
export function boardTasks(
  store: Store,
  today: string,
  view: ViewSpec,
  closedDays = 7,
): Item[] {
  return selected(store, today, view, addDays(today, -closedDays));
}

/** A span of calendar days, both inclusive. */
export type Span = { from: string; to: string };
/** The widest span a calendar asks for: six weeks. */
export const MAX_SPAN_DAYS = 42;

/** One day a task stands on (views Q11). */
export type Placement = {
  taskId: string;
  date: string;
  kind: 'scheduled' | 'due';
  /** The occurrence a recurring task's scheduled placement stands for;
   *  null for a one-off task and for every due placement. */
  occurrence: string | null;
  /** Closed within `closedDays` (departure 2): shown, not movable. */
  closed: boolean;
};
export type Calendar = { items: Item[]; placements: Placement[] };

/**
 * The view's tasks placed on the days of `span`: the filter and sort of
 * boardTasks (departure 1), then each task's placements. Placements are
 * ordered by date, then by the view's order, then scheduled before due.
 * `items` holds only tasks with a placement in the span. Throws UsageError
 * for a span that is not two dates in order, or wider than MAX_SPAN_DAYS.
 */
export function calendarTasks(
  store: Store,
  today: string,
  view: ViewSpec,
  span: Span,
  closedDays = 7,
): Calendar {
  const days = (Date.parse(span.to) - Date.parse(span.from)) / 86_400_000 + 1;
  if (!isIsoDate(span.from) || !isIsoDate(span.to) || days < 1) {
    throw new UsageError('span must be two dates, from on or before to');
  }
  if (days > MAX_SPAN_DAYS) {
    throw new UsageError(`span is wider than ${MAX_SPAN_DAYS} days`);
  }
  const since = addDays(today, -closedDays);
  const all = tasks(store);
  const marks = new Map(
    occurrences(store).map((m) => [
      JSON.stringify([m.taskId, m.occurrence ?? null]),
      m,
    ]),
  );
  const inSpan = (d: unknown): d is string =>
    typeof d === 'string' && d >= span.from && d <= span.to;
  const items = selected(store, today, view, since);
  const placed = new Set<string>();
  const placements = items.flatMap((item) => {
    const taskId = String(item.id);
    const found: Placement[] = [];
    const put = (
      date: string,
      kind: Placement['kind'],
      occurrence: string | null,
      closed: boolean,
    ) => found.push({ taskId, date, kind, occurrence, closed });
    const recurrence = recurrenceOf(item, parentOf(all, item));
    if (recurrence === null) {
      if (inSpan(item.scheduledOn))
        put(item.scheduledOn, 'scheduled', null, item.closed);
      if (inSpan(item.dueOn)) put(item.dueOn, 'due', null, item.closed);
    } else {
      // The lower bound is a cost, not a behaviour: expand walks from
      // dtstart either way, and an earlier open occurrence is dropped below.
      for (const date of expand(
        recurrence.rule,
        recurrence.dtstart,
        span.from,
        span.to,
      )) {
        const mark = marks.get(JSON.stringify([taskId, date]));
        if (mark?.state === 'skipped') continue;
        if (mark?.state === 'done') {
          const at = (
            mark.fieldTs as Record<string, string> | undefined
          )?.state?.slice(0, 10);
          if (at === undefined || at >= since)
            put(date, 'scheduled', date, true);
        } else if (item.occurrence !== null && date >= item.occurrence) {
          put(date, 'scheduled', date, false);
        }
      }
      if (inSpan(item.dueOn)) put(item.dueOn, 'due', null, false);
    }
    if (found.length > 0) placed.add(taskId);
    return found;
  });
  // Stable: ties keep the view's order, then scheduled before due.
  placements.sort((a, b) => a.date.localeCompare(b.date));
  return { items: items.filter((i) => placed.has(String(i.id))), placements };
}

/** One row of a drawer's checklist: closed at the parent's current
 *  occurrence (ADR 0009), or by its own mark under a one-off parent. */
export type Subtask = { id: string; title: string; closed: boolean };

export type TaskDetails = Item & {
  notes: string | null;
  rrule: string | null;
  dtstart: string | null;
  /** Live subtasks by rank, then id. */
  subtasks: Subtask[];
};

/** One task for the drawer: the row, labels, current occurrence, column,
 *  closed state; null when it is deleted or unknown. A recurring task whose
 *  series ended is live: `closed`, with no occurrence. */
export function taskDetails(
  store: Store,
  today: string,
  id: string,
): TaskDetails | null {
  const found = due(store, today, null).find(({ row }) => row.id === id);
  if (found === undefined) return null;
  const { notes, rrule, dtstart, occurrence } = found.row;
  const marks = occurrences(store);
  // A series that ended has no axis to tick on; one-off marks left from when
  // the parent was one-off no longer apply (departure 8).
  const ended = typeof rrule === 'string' && occurrence === null;
  const subtasks = liveTasks(tasks(store))
    .filter((t) => t.parentId === id)
    .sort((a, b) => compareStrings(a.rank, b.rank) || compareIds(a, b))
    .map((t) => ({
      id: String(t.id),
      title: String(t.title),
      closed: !ended && isClosed(stateOf(marks, String(t.id))(occurrence)),
    }));
  return {
    ...itemOf(titlesOf(store))(found),
    notes: typeof notes === 'string' ? notes : null,
    rrule: typeof rrule === 'string' ? rrule : null,
    dtstart: typeof dtstart === 'string' ? dtstart : null,
    subtasks,
  };
}

/** What the sidebar, forms and pickers need: live views by rank (with
 *  `problem` from filterProblem), live statuses by rank then id with
 *  `completing` resolved by completingStatus, live projects and tags by name. */
export function catalog(store: Store): Catalog {
  const byName = (a: Row, b: Row) =>
    compareStrings(a.name, b.name) || compareIds(a, b);
  const statuses = notDeleted(statusRows(store)).sort(
    (a, b) => compareStrings(a.rank, b.rank) || compareIds(a, b),
  );
  const completing = completingStatus(statusFacts(statuses));
  const perStatus = new Map<unknown, number>();
  for (const t of liveTasks(tasks(store))) {
    perStatus.set(t.statusId, (perStatus.get(t.statusId) ?? 0) + 1);
  }
  const version = (row: Row) =>
    typeof row.version === 'number' ? row.version : null;
  return {
    views: listViews(store).map((v) => ({
      id: String(v.id),
      name: String(v.name),
      layout: String(v.layout),
      sort: String(v.sort),
      filter: v.filter,
      rank: String(v.rank),
      version: version(v),
      problem: filterProblem(v.filter),
    })),
    statuses: statuses.map((s) => ({
      id: String(s.id),
      name: String(s.name),
      rank: String(s.rank),
      color: typeof s.color === 'string' ? s.color : null,
      completing: s.id === completing,
      /** Live tasks with this `statusId`: what deleting the status moves. */
      tasks: perStatus.get(s.id) ?? 0,
      version: version(s),
    })),
    projects: liveProjects(projects(store))
      .sort(byName)
      .map((p) => ({ id: String(p.id), name: String(p.name) })),
    tags: liveTags(tagRows(store))
      .sort(byName)
      .map((t) => ({ id: String(t.id), name: String(t.name) })),
  };
}
export type Catalog = {
  views: {
    id: string;
    name: string;
    layout: string;
    sort: string;
    filter: unknown;
    rank: string;
    version: number | null;
    problem: string | null;
  }[];
  statuses: {
    id: string;
    name: string;
    rank: string;
    color: string | null;
    completing: boolean;
    tasks: number;
    version: number | null;
  }[];
  projects: { id: string; name: string }[];
  tags: { id: string; name: string }[];
};

/** After a pull: drop moot failed entries, queue the duplicate-name merge.
 *  Returns the merged names when it queued anything, else []. */
export function reconcile(core: Core): string[] {
  const { store } = core;
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
    core.newId,
    core.now().toISOString(),
  );
  if (ops.length > 0) {
    store.transaction(() => {
      for (const op of ops) store.enqueue(op);
    });
    return merged;
  }
  return [];
}

export type ViewFields = {
  name: string;
  layout: 'list' | 'kanban' | 'calendar';
  sort: 'manual' | 'priority' | 'due' | 'scheduled';
  filter: unknown;
};

const LAYOUTS = ['list', 'kanban', 'calendar'];
const SORTS = ['manual', 'priority', 'due', 'scheduled'];

const byRank = (a: Row, b: Row) =>
  compareStrings(a.rank, b.rank) || compareIds(a, b);

/** Structural equality of JSON values; object key order does not matter. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every(
      (k) =>
        k in b &&
        sameJson(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}

/** A seen `opId` only flushes, before any validation. */
async function replayed(core: Core, opId: string) {
  if (!core.store.seen(opId)) return undefined;
  return { synced: (await flush(core.store, core.send)).synced };
}

function submitOwn(core: Core, ops: Op[], command: string, opId: string) {
  return submit(
    core.store,
    core.send,
    withFirstId(ops, opId),
    command,
    opId,
    core.now().getTime(),
  );
}

/** A name no other live row of `rows` has, trimmed and non-empty. */
function uniqueName(rows: Row[], id: string, name: string, what: string) {
  const trimmed = requiredName(name, `${what} name`);
  const key = nameKey(trimmed);
  if (
    rows.some(
      (r) =>
        r.id !== id && typeof r.name === 'string' && nameKey(r.name) === key,
    )
  ) {
    throw new UsageError(`a ${what} named ${trimmed} already exists`);
  }
  return trimmed;
}

/**
 * Create (id unknown) or update (one `set` per changed field) a view. A new
 * view ranks after the last. Replay-safe.
 */
export async function saveView(
  core: Core,
  minted: Minted & { id: string },
  fields: ViewFields,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const all = viewRows(core.store);
  const live = notDeleted(all);
  const existing = all.find((v) => v.id === minted.id);
  if (existing !== undefined && existing.deletedAt !== null) {
    throw new UsageError(`no view ${minted.id}`);
  }
  const name = uniqueName(live, minted.id, fields.name, 'view');
  if (!LAYOUTS.includes(fields.layout)) {
    throw new UsageError(`layout must be one of ${LAYOUTS.join(', ')}`);
  }
  if (!SORTS.includes(fields.sort)) {
    throw new UsageError(`sort must be one of ${SORTS.join(', ')}`);
  }
  const problem = filterProblem(fields.filter);
  if (problem !== null) throw new UsageError(problem);
  const ts = core.now().toISOString();
  const written = {
    name,
    layout: fields.layout,
    sort: fields.sort,
    filter: fields.filter,
  };
  const ops: Op[] =
    existing === undefined
      ? [
          {
            opId: core.newId(),
            kind: 'create',
            table: 'view',
            id: minted.id,
            fields: {
              ...written,
              rank: rankBetween(
                ([...live].sort(byRank).at(-1)?.rank as string | undefined) ??
                  null,
                null,
              ),
            },
            ts,
          },
        ]
      : Object.entries(written)
          .filter(([k, v]) => !sameJson(existing[k], v))
          .map(([k, v]) => setRow('view', existing, k, v, core.newId, ts));
  return { synced: await submitOwn(core, ops, 'view', minted.opId) };
}

/** A delete's `baseVersion` is the row's version; an unsynced row has none. */
function syncedRow(
  rows: Row[],
  id: string,
  what: string,
): Row & { version: number } {
  const row = notDeleted(rows).find((r) => r.id === id);
  if (row === undefined) throw new UsageError(`no ${what} ${id}`);
  if (typeof row.version !== 'number') {
    throw new UsageError(`${what} ${id} is not synced yet`);
  }
  return row as Row & { version: number };
}

const deleteOp = (
  table: 'task' | 'view' | 'status',
  row: Row & { version: number },
  newId: () => string,
): Op => ({
  opId: newId(),
  kind: 'delete',
  table,
  id: String(row.id),
  baseVersion: row.version,
});

/**
 * A task a destructive op may cite by `version`: live, synced, and with no
 * task op still queued for it, since a queued op would raise the server's
 * version past the one sent (departure 3). Throws UsageError `no task <id>`
 * or `<what> <id> is not synced yet`.
 */
function settledTask(
  store: Store,
  all: Row[],
  id: string,
  what: 'task' | 'subtask',
): Row & { version: number } {
  liveTask(all, id);
  if (store.pending().some((op) => op.table === 'task' && op.id === id)) {
    throw new UsageError(`${what} ${id} is not synced yet`);
  }
  return syncedRow(all, id, what);
}

/** Refuses a view without a `version` ("not synced yet"). Replay-safe. */
export async function deleteView(
  core: Core,
  minted: Minted,
  id: string,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const row = syncedRow(viewRows(core.store), id, 'view');
  return {
    synced: await submitOwn(
      core,
      [deleteOp('view', row, core.newId)],
      'view',
      minted.opId,
    ),
  };
}

/**
 * Create (id unknown; ranks after `after`, or last) or rename and/or reorder
 * (`after`: the status it follows; null: first). Names are nameKey-unique.
 */
export async function saveStatus(
  core: Core,
  minted: Minted & { id: string },
  change: { name?: string; after?: string | null },
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const all = statusRows(core.store);
  const live = notDeleted(all);
  const existing = all.find((s) => s.id === minted.id);
  if (existing !== undefined && existing.deletedAt !== null) {
    throw new UsageError(`no status ${minted.id}`);
  }
  const ts = core.now().toISOString();
  const name =
    change.name === undefined
      ? undefined
      : uniqueName(live, minted.id, change.name, 'status');
  if (existing === undefined && name === undefined) {
    throw new UsageError('status name must not be empty');
  }
  const ordered = live.filter((s) => s.id !== minted.id).sort(byRank);
  const after =
    change.after === undefined && existing === undefined
      ? ((ordered.at(-1)?.id as string | undefined) ?? null)
      : change.after;
  if (after != null && !ordered.some((s) => s.id === after)) {
    throw new UsageError(`no status ${after}`);
  }
  const ranks =
    after === undefined
      ? []
      : rankWrites(
          ordered.map((s) => ({ id: String(s.id), rank: String(s.rank) })),
          minted.id,
          after,
        );
  const ops: Op[] = [];
  if (existing === undefined) {
    const mine = ranks.find((r) => r.id === minted.id)!;
    ops.push({
      opId: core.newId(),
      kind: 'create',
      table: 'status',
      id: minted.id,
      fields: { name, rank: mine.rank, completing: false },
      ts,
    });
  } else if (name !== undefined && name !== existing.name) {
    ops.push(setRow('status', existing, 'name', name, core.newId, ts));
  }
  for (const { id, rank } of ranks) {
    if (existing === undefined && id === minted.id) continue;
    ops.push(setRow('status', { id }, 'rank', rank, core.newId, ts));
  }
  return { synced: await submitOwn(core, ops, 'status', minted.opId) };
}

/** `completing: true` on this one and false on every other that has it. */
export async function setCompleting(
  core: Core,
  minted: Minted,
  id: string,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const live = notDeleted(statusRows(core.store));
  const target = live.find((s) => s.id === id);
  if (target === undefined) throw new UsageError(`no status ${id}`);
  const ts = core.now().toISOString();
  const ops = live
    .filter((s) => s.id !== id && s.completing === true)
    .sort(compareIds)
    .map((s) => setRow('status', s, 'completing', false, core.newId, ts));
  if (target.completing !== true) {
    ops.push(setRow('status', target, 'completing', true, core.newId, ts));
  }
  return { synced: await submitOwn(core, ops, 'status', minted.opId) };
}

/**
 * One batch: `set statusId null` for every live task on the status, then
 * `delete` (views Q8). Refuses the completing status, the last non-completing
 * one, and one without a `version`. Replay-safe.
 */
export async function deleteStatus(
  core: Core,
  minted: Minted,
  id: string,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const all = statusRows(core.store);
  const row = syncedRow(all, id, 'status');
  if (row.completing === true) {
    throw new UsageError('the completing status cannot be deleted');
  }
  if (notDeleted(all).filter((s) => s.completing !== true).length < 2) {
    throw new UsageError('the last open status cannot be deleted');
  }
  const ts = core.now().toISOString();
  const ops: Op[] = [
    ...liveTasks(tasks(core.store))
      .filter((t) => t.statusId === id)
      .sort(compareIds)
      .map((t) => setTask(t, 'statusId', null, core.newId, ts)),
    deleteOp('status', row, core.newId),
  ];
  return { synced: await submitOwn(core, ops, 'status', minted.opId) };
}

/** Queues seedOps when there is no live status; returns whether it did. */
export function seedStatuses(core: Core): boolean {
  const { store } = core;
  return store.transaction(() => {
    if (notDeleted(statusRows(store)).length > 0) return false;
    for (const op of seedOps(core.newId, core.now().toISOString())) {
      store.enqueue(op);
    }
    return true;
  });
}

/**
 * Moves one occurrence of a recurring task to `to` (views Q13): a one-off
 * copy with id `minted.id` on `to`, carrying title, notes, projectId, the
 * attached tags, priority, statusId and the original's rank, plus
 * originTaskId and originOccurrence; then `skip` of the occurrence. One
 * batch, the copy first (departure 4). Replay-safe.
 */
export async function moveOccurrence(
  core: Core,
  minted: Minted & { id: string },
  taskId: string,
  occurrence: string,
  to: string,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const { store } = core;
  const all = tasks(store);
  const task = liveTask(all, taskId);
  if (recurrenceOf(task, parentOf(all, task)) === null) {
    throw new UsageError('only a recurring task has occurrences to move');
  }
  if (!isIsoDate(to)) throw new UsageError('to must be a date, YYYY-MM-DD');
  if (to === occurrence)
    throw new UsageError('the occurrence is already there');
  const plan = planMark(core, 'skip', task, all, occurrence, undefined);
  if (plan.closed !== undefined) {
    throw new UsageError(`already ${plan.closed} — undo it first`);
  }
  const ts = core.now().toISOString();
  const optional = Object.fromEntries(
    (['notes', 'projectId', 'statusId'] as const)
      .filter((field) => task[field] !== null && task[field] !== undefined)
      .map((field) => [field, task[field]]),
  );
  const copy: OpCreate = {
    opId: minted.opId,
    kind: 'create',
    table: 'task',
    id: minted.id,
    fields: {
      title: task.title,
      priority: task.priority,
      rank: task.rank,
      ...optional,
      scheduledOn: to,
      originTaskId: taskId,
      originOccurrence: occurrence,
    },
    ts,
  };
  const live = new Set(liveTags(tagRows(store)).map((tag) => String(tag.id)));
  const tagOps: OpCreate[] = links(store)
    .filter(
      (link) =>
        link.taskId === taskId &&
        isAttached(link) &&
        live.has(String(link.tagId)),
    )
    .map((link) => String(link.tagId))
    .sort()
    .map((tagId) => ({
      opId: core.newId(),
      kind: 'create',
      table: 'task_tag',
      id: taskTagId(minted.id, tagId),
      fields: { taskId: minted.id, tagId },
      ts,
    }));
  return {
    synced: await submitOwn(
      core,
      [copy, ...tagOps, plan.op],
      'move',
      minted.opId,
    ),
  };
}

/**
 * Undoes a move (views Q13): deletes the copy, then reopens its origin
 * occurrence if it is still skipped. One batch. Refuses (UsageError) a task
 * without origin fields, a copy with no `version` or with queued ops, a copy
 * with live subtasks, and a copy whose original is not live (departure 5).
 * Replay-safe.
 */
export async function undoMove(
  core: Core,
  minted: Minted,
  copyId: string,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const { store } = core;
  const all = tasks(store);
  const copy = liveTask(all, copyId);
  const { originTaskId, originOccurrence } = copy;
  if (
    typeof originTaskId !== 'string' ||
    typeof originOccurrence !== 'string'
  ) {
    throw new UsageError(`task ${copyId} is not a moved occurrence`);
  }
  const row = settledTask(store, all, copyId, 'task');
  if (liveTasks(all).some((t) => t.parentId === copyId)) {
    throw new UsageError(`task ${copyId} has subtasks`);
  }
  if (!liveTasks(all).some((t) => t.id === originTaskId)) {
    throw new UsageError(`the original task of ${copyId} is gone`);
  }
  const ts = core.now().toISOString();
  const reopen: OpCreate[] =
    stateOf(occurrences(store), originTaskId)(originOccurrence) === 'skipped'
      ? [
          {
            opId: core.newId(),
            kind: 'create',
            table: 'task_occurrence',
            id: taskOccurrenceId(originTaskId, originOccurrence),
            fields: {
              taskId: originTaskId,
              occurrence: originOccurrence,
              state: 'open',
              completedAt: null,
            },
            ts,
          },
        ]
      : [];
  return {
    synced: await submitOwn(
      core,
      [deleteOp('task', row, core.newId), ...reopen],
      'move',
      minted.opId,
    ),
  };
}

/**
 * Deletes a task and its live subtasks (#391): one batch, each live
 * subtask's `delete` (by id) before the parent's, each with the row's
 * `version` as `baseVersion`. Every row must be settled. No undo.
 * Replay-safe.
 */
export async function deleteTask(
  core: Core,
  minted: Minted,
  taskId: string,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const { store } = core;
  const all = tasks(store);
  const parent = settledTask(store, all, taskId, 'task');
  const subtasks = liveTasks(all)
    .filter((t) => t.parentId === taskId)
    .sort(compareIds)
    .map((t) => settledTask(store, all, String(t.id), 'subtask'));
  const ops = [...subtasks, parent].map((row) =>
    deleteOp('task', row, core.newId),
  );
  return { synced: await submitOwn(core, ops, 'delete', minted.opId) };
}

export type Rule = { rrule: string; dtstart: string };

/**
 * Sets, changes or clears (null) a task's rule (#414 decision 1), one batch.
 * Op i carries baseVersion `version + i` (departure 2): the server bumps the
 * row's version per op, so each op cites the version its predecessor leaves.
 * A batch the server applies only in part leaves some fields written and
 * others not, and not only the earlier ones: if another device's single write
 * moves the version to v+1, `set rrule` (base v) conflicts while `set dtstart`
 * (base v+1) applies, leaving a new dtstart with the old rrule. The next pull
 * shows what stuck.
 * Recurring → one-off: rrule null, dtstart null, scheduledOn = the current
 * occurrence. One-off → recurring: dtstart (when it differs), rrule,
 * scheduledOn null. Recurring → recurring: rrule, then dtstart, each when it
 * differs. Fields equal to the stored value are left out; an unchanged rule
 * queues nothing. Refuses a subtask, a moved copy (a one-off by design), a
 * rule ruleProblem refuses, and (when anything would be written) a task that
 * is not settled. Replay-safe.
 */
export async function setRecurrence(
  core: Core,
  minted: Minted,
  taskId: string,
  rule: Rule | null,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const { store } = core;
  const all = tasks(store);
  const task = liveTask(all, taskId);
  if (task.parentId !== null && task.parentId !== undefined) {
    throw new UsageError('a subtask repeats with its parent');
  }
  if (rule !== null && task.originTaskId != null) {
    throw new UsageError(
      'a moved occurrence cannot repeat — return it to its series first',
    );
  }
  if (rule !== null) {
    const problem = ruleProblem(rule.rrule, rule.dtstart);
    if (problem !== null) throw new UsageError(problem);
  }
  const current = recurrenceOf(task, undefined);
  const wanted: [string, unknown][] =
    rule === null
      ? current === null
        ? []
        : [
            ['rrule', null],
            ['dtstart', null],
            [
              'scheduledOn',
              currentOccurrence(
                current,
                stateOf(occurrences(store), taskId),
                localDate(core.now()),
              )?.occurrence ?? null,
            ],
          ]
      : current === null
        ? [
            ['dtstart', rule.dtstart],
            ['rrule', rule.rrule],
            ['scheduledOn', null],
          ]
        : [
            ['rrule', rule.rrule],
            ['dtstart', rule.dtstart],
          ];
  const fields = wanted.filter(([k, v]) => !sameJson(task[k] ?? null, v));
  if (fields.length === 0) {
    return { synced: await submitOwn(core, [], 'rule', minted.opId) };
  }
  const { version } = settledTask(store, all, taskId, 'task');
  const ts = core.now().toISOString();
  const ops = fields.map(([k, v], i) => ({
    ...setTask(task, k, v, core.newId, ts),
    baseVersion: version + i,
  }));
  return { synced: await submitOwn(core, ops, 'rule', minted.opId) };
}

/**
 * Indents a task under `parentId`, or outdents it (null): one
 * `set parentId`. Refuses, before queuing anything, what the server refuses:
 * a task as its own parent, a parent that has one (the two-level rule and
 * every cycle), a task with live subtasks, and a recurring task under a
 * parent (a subtask repeats with its parent, ADR 0009). A tombstoned subtask
 * does not count. An unchanged parent queues nothing. Replay-safe.
 */
export async function reparent(
  core: Core,
  minted: Minted,
  taskId: string,
  parentId: string | null,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const all = tasks(core.store);
  const task = liveTask(all, taskId);
  if (parentId !== null) {
    if (parentId === taskId) {
      throw new UsageError('a task cannot be its own parent');
    }
    if (typeof liveTask(all, parentId).parentId === 'string') {
      throw new UsageError('a subtask cannot have subtasks');
    }
    if (liveTasks(all).some((t) => t.parentId === taskId)) {
      throw new UsageError('a task with subtasks cannot become a subtask');
    }
    if (typeof task.rrule === 'string') {
      throw new UsageError('a recurring task cannot become a subtask');
    }
  }
  const ops =
    (task.parentId ?? null) === parentId
      ? []
      : [
          setTask(
            task,
            'parentId',
            parentId,
            core.newId,
            core.now().toISOString(),
          ),
        ];
  return { synced: await submitOwn(core, ops, 'reparent', minted.opId) };
}
