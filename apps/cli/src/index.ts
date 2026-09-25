#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { planAdd } from './parse-quick-add.js';
import { BASE, TOKEN, STATE } from './config.js';
import { HELP, unknownCommand, wantsHelp } from './usage.js';
import {
  applyChanges, assertNotRefused, liveTasks, readSyncResponse,
  ConflictError, NetworkError, RefusalError, UsageError, type State,
} from './protocol.js';

async function load(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE, 'utf8')) as State;
  } catch {
    return { cursor: 0, rows: {} };
  }
}

async function save(state: State): Promise<void> {
  await mkdir(dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify(state), { mode: 0o600 });
}

async function sync(ops: unknown[]) {
  const state = await load();
  let response: Response;
  try {
    response = await fetch(`${BASE}/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ since: state.cursor, ops }),
    });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }
  const body = await readSyncResponse(response);
  applyChanges(state, body.changes);
  state.cursor = body.cursor;
  await save(state);
  return { state, results: body.results };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv)) {
    console.log(HELP);
    return;
  }
  const json = argv.includes('--json');
  const [command, ...rest] = argv.filter((arg) => arg !== '--json');

  if (command === 'add') {
    // Refuses an empty title and reports what it is not storing — see planAdd.
    const { title, priority, notice } = planAdd(rest.join(' '));
    // stderr, so --json's stdout stays a single parseable value.
    if (notice !== null) console.error(notice);
    const opId = uuidv7();
    const id = uuidv7();
    const { state, results } = await sync([
      {
        opId, kind: 'create', table: 'task', id,
        fields: { title, priority, rank: 'a0' },
        ts: new Date().toISOString(),
      },
    ]);
    assertNotRefused(results, opId);
    if (json) {
      console.log(JSON.stringify(state.rows.task?.[id] ?? null));
    } else {
      console.log(title);
    }
  } else if (command === 'list') {
    const { state } = await sync([]);
    const tasks = liveTasks(state);
    if (json) {
      console.log(JSON.stringify(tasks));
    } else {
      for (const row of tasks) {
        console.log(`${String(row.priority)}  ${String(row.title)}`);
      }
    }
  } else {
    throw unknownCommand(command);
  }
}

main().catch((error: unknown) => {
  // The one place an error class becomes an exit code; the classes themselves
  // and what each one means to a caller are in protocol.ts.
  if (error instanceof UsageError) {
    // The message, not the whole of HELP: a caller that mistyped a command
    // does not need thirty lines of stderr, and the one that does is one
    // flag away from them.
    console.error(`${error.message}\nrun \`todoer --help\` for usage and exit codes`);
    process.exit(2);
  }
  if (error instanceof RefusalError) {
    console.error(error.message);
    process.exit(1);
  }
  if (error instanceof ConflictError) {
    console.error(error.message);
    process.exit(4);
  }
  // NetworkError, and anything unrecognised: a caller that retries on 3 is
  // retrying something that might genuinely succeed next time.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
});
