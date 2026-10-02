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
import { planMerge } from './merge.js';
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
 */
export async function submit(
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
    if (
      current === null &&
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

/** `add`: quick-add text plus already-validated recurrence fields. */
export async function add(
  core: Core,
  text: string,
  recurrence: Record<string, string>,
): Promise<{
  synced: boolean;
  title: string;
  created: string[];
  task: Row | null;
}> {
  const { store, send } = core;
  // Refuses an empty title — see planAdd.
  const { title, priority, project, tags } = planAdd(text);
  const ts = core.now().toISOString();
  const labels = resolveLabels(
    { project, tags },
    { projects: projects(store), tags: tagRows(store) },
    core.newId,
    ts,
  );
  const op: OpCreate = {
    opId: core.newId(),
    kind: 'create',
    table: 'task',
    id: core.newId(),
    fields: {
      title,
      priority,
      rank: 'a0',
      ...(labels.projectId === null ? {} : { projectId: labels.projectId }),
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
  );
  const task = tasks(store).find((row) => row.id === op.id) ?? null;
  return { synced, title, created: labels.created, task };
}

/** done / skip / undo on the task `ref` names, at `on` or the default occurrence. */
export async function mark(
  core: Core,
  command: Mark,
  ref: string,
  on: string | undefined,
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
  const task = resolveRef(liveTasks(all), ref);
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
  const closed = state === 'done' || state === 'skipped' ? state : undefined;
  if (closed !== undefined && closed !== MARK[command]) {
    throw new UsageError(`already ${closed} — undo it first`);
  }
  const now = core.now().toISOString();
  const op: OpCreate = {
    opId: core.newId(),
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
  const synced =
    closed !== undefined
      ? (await flush(store, send)).synced
      : await submit(
          store,
          send,
          () => [
            ...statusOps(command, task, statusRows(store), core.newId, now),
            op,
          ],
          command,
        );
  const marked = occurrences(store).find((row) => row.id === op.id) ?? null;
  return { synced, task, occurrence, closed, marked };
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
export type Item = Due & { column: string | null; closed: boolean };

function itemOf({ row, facts, closed }: Listed): Item {
  return { ...row, column: facts.statusId, closed };
}

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
  ).map(itemOf);
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

/** One task for the drawer: the row, labels, current occurrence, column,
 *  closed state; null when it is deleted or unknown. */
export function taskDetails(
  store: Store,
  today: string,
  id: string,
): (Item & { notes: string | null; rrule: string | null }) | null {
  const found = due(store, today, null).find(({ row }) => row.id === id);
  if (found === undefined) return null;
  const { notes, rrule } = found.row;
  return {
    ...itemOf(found),
    notes: typeof notes === 'string' ? notes : null,
    rrule: typeof rrule === 'string' ? rrule : null,
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
