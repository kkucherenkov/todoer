import {
  addDays,
  isIsoDate,
  nameKey,
  parseRrule,
  type Rrule,
} from '@todoer/specs';
import {
  add,
  adoptAccount,
  expand,
  flush,
  HORIZON_DAYS,
  isMark,
  listTasks,
  listViews,
  localDate,
  mark,
  MARK,
  PROJECT,
  reconcile,
  RefusalError,
  TAG,
  UsageError,
  type AuthApi,
  type LabelFilter,
  type Store,
  type TokenSource,
  type Transport,
} from '@todoer/client-core';
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
    const added = await add(deps, from.rest.join(' '), recurrence.fields);
    if (added.created.length > 0) {
      stderr.push(`note: created ${added.created.join(' ')}`);
    }
    synced = added.synced;
    data = added.task;
    human = [added.title];
  } else if (command === 'list') {
    const view = takeOption(rest, '--view');
    const filters: LabelFilter[] = view.rest.map((arg) => {
      if (TAG.test(arg)) return { tag: nameKey(arg) };
      if (PROJECT.test(arg)) return { project: nameKey(arg.slice(1)) };
      throw new UsageError(
        `list takes @tag and #project filters, not ${JSON.stringify(arg)}`,
      );
    });
    ({ synced } = await flush(store, deps.send));
    const rows = listTasks(store, localDate(deps.now()), filters, view.value);
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
    const rows = listViews(store);
    data = rows;
    human = rows.map((v) => [v.name, v.layout, v.sort].map(String).join('  '));
  } else if (isMark(command)) {
    const on = takeOption(rest, '--on');
    const [ref, ...extra] = on.rest;
    if (ref === undefined || extra.length > 0) {
      throw new UsageError(`${command} needs exactly one task id or id suffix`);
    }
    const result = await mark(deps, command, ref, on.value);
    synced = result.synced;
    data = result.marked;
    // I3: `submit` settled this op, but the row it settled to is not the
    // state this command wrote — a newer change from elsewhere won under
    // per-field LWW. --json already carries the real state; a plain caller
    // gets no other signal that its mark did not stick.
    if (
      synced &&
      result.marked !== null &&
      result.marked.state !== MARK[command]
    ) {
      stderr.push(
        `note: the server kept '${String(result.marked.state)}' — a later change from another device decided this occurrence`,
      );
    }
    human = [
      [
        result.closed !== undefined ? `already ${result.closed}` : command,
        String(result.task.title),
        ...(result.occurrence === null ? [] : [result.occurrence]),
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
    for (const name of reconcile(deps)) {
      stderr.push(
        `note: merging duplicate ${name} — sent with the next command`,
      );
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
