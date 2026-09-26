import type { OpCreate } from '@todoer/specs';
import { liveTasks, overlay } from './overlay.js';
import { planAdd } from './parse-quick-add.js';
import { ownOutcome, UsageError } from './protocol.js';
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
 * Every command: flush the outbox and pull first (design doc, Q5), then
 * answer from the replica with the outbox applied on top. Exit 5 whenever
 * the server was not reached (Q3). Refusals and conflicts of the command's
 * own operation are thrown; index.ts turns them into exit codes.
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
    // Refuses an empty title and reports what it is not storing — see planAdd.
    const { title, priority, notice } = planAdd(rest.join(' '));
    if (notice !== null) stderr.push(notice);
    const op: OpCreate = {
      opId: deps.newId(),
      kind: 'create',
      table: 'task',
      id: deps.newId(),
      fields: { title, priority, rank: 'a0' },
      ts: deps.now().toISOString(),
    };
    // Stored before it is sent: from here on, every attempt carries this id.
    store.enqueue(op);
    const flushed = await flush(store, deps.send, new Set([op.opId]));
    // Evaluated unconditionally, never short-circuited on `flushed.synced`:
    // a batch-refused own op is removed from the outbox (I1) even when the
    // follow-up pull that reports it is itself unreached, and that
    // rejection must still throw rather than be reported as "queued".
    const own = ownOutcome(flushed.results, op.opId);
    synced = flushed.synced && own === 'settled';
    data = tasks(store).find((row) => row.id === op.id) ?? null;
    human = [title];
  } else if (command === 'list') {
    ({ synced } = await flush(store, deps.send));
    const rows = liveTasks(tasks(store));
    data = rows;
    human = rows.map((row) => `${String(row.priority)}  ${String(row.title)}`);
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

function tasks(store: Store): Row[] {
  return overlay('task', store.rows('task'), store.pending());
}
