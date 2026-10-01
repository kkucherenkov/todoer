import {
  isIsoDate,
  parseRrule,
  taskOccurrenceId,
  taskTagId,
  type OpCreate,
  type Rrule,
} from '@todoer/specs';
import { expand } from './expand.js';
import {
  addDays,
  currentOccurrence,
  HORIZON_DAYS,
  isOccurrence,
  latestClosed,
  localDate,
  recurrenceOf,
  type Recurrence,
  type StateOf,
} from './occurrence.js';
import { resolveLabels } from './labels.js';
import { liveTasks, overlay } from './overlay.js';
import { planAdd } from './parse-quick-add.js';
import { ownOutcome, RefusalError, UsageError } from './protocol.js';
import { resolveRef, shortRef } from './ref.js';
import type { Row, Store } from './store.js';
import { flush, type Transport } from './sync.js';
import { unknownCommand } from './usage.js';

export type Deps = {
  store: Store;
  send: Transport;
  now: () => Date;
  newId: () => string;
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
type Due = Row & { ref: string; occurrence: string | null };

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
    synced = await submit(store, deps.send, [...labels.creates, op, ...linkOps], 'add');
    data = tasks(store).find((row) => row.id === op.id) ?? null;
    human = [title];
  } else if (command === 'list') {
    ({ synced } = await flush(store, deps.send));
    const rows = due(store, localDate(deps.now()));
    data = rows;
    human = rows.map((row) =>
      [
        row.ref,
        String(row.priority),
        String(row.title),
        ...(row.occurrence === null ? [] : [row.occurrence]),
      ].join('  '),
    );
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
    synced = await submit(store, deps.send, [op], command);
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
        command,
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
    const entries = store.entries();
    data = entries;
    human = entries.map((e) =>
      [e.status, e.opId, `${e.op.kind} ${e.op.table}`, e.reason ?? '']
        .join('  ')
        .trimEnd(),
    );
  } else {
    throw unknownCommand(
      command === 'outbox' ? `outbox ${rest.join(' ')}` : command,
    );
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
 * Queues the operations the running command minted, in one transaction and in
 * order, and sends them: stored before they are sent, so every attempt
 * carries their ids (ADR 0015 §4). Every one counts as the command's own, so
 * a refusal of any of them is the command's exit 1. Returns whether the
 * server has all of them.
 */
async function submit(
  store: Store,
  send: Transport,
  ops: OpCreate[],
  command: string,
): Promise<boolean> {
  store.transaction(() => {
    for (const op of ops) store.enqueue(op);
  });
  const opIds = ops.map((op) => op.opId);
  const flushed = await flushOwn(store, send, opIds, command);
  let settled = true;
  for (const opId of opIds) {
    // Evaluated unconditionally, never short-circuited on `flushed.synced`:
    // a batch-refused own op is removed from the outbox (I1) even when the
    // follow-up pull that reports it is itself unreached, and that
    // rejection must still throw rather than be reported as "queued".
    let own = ownOutcome(flushed.results, opId);
    if (own === 'unreported' && flushed.synced) {
      // A parallel invocation may have sent it between the enqueue and this
      // flush's read of the outbox; its entry says what became of it.
      const entry = store.entry(opId);
      if (entry === undefined) own = 'settled';
      else if (entry.status === 'failed') {
        store.remove(opId);
        throw new RefusalError(
          entry.reason ?? 'the server refused this operation',
        );
      }
    }
    if (own !== 'settled') settled = false;
  }
  return flushed.synced && settled;
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
        `${error.message} — this command's ${which} queued and will be sent once the request is accepted — do not run ${command} again for it`,
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

/** Each live task once, at its current occurrence (plan C design, Q11). */
function due(store: Store, today: string): Due[] {
  const all = tasks(store);
  const marks = occurrences(store);
  return liveTasks(all).flatMap((task) => {
    const taskId = String(task.id);
    const current = currentOccurrence(
      recurrenceOf(task, parentOf(all, task)),
      stateOf(marks, taskId),
      today,
    );
    return current === null
      ? []
      : [{ ...task, ref: shortRef(taskId), occurrence: current.occurrence }];
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
