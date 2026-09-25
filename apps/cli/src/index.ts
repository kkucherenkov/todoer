#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { parseQuickAdd } from './parse-quick-add.js';
import { BASE, TOKEN, STATE } from './config.js';
import {
  applyChanges, assertNotRejected, liveTasks, readSyncResponse,
  NetworkError, RefusalError, type State,
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
  const json = argv.includes('--json');
  const [command, ...rest] = argv.filter((arg) => arg !== '--json');

  if (command === 'add') {
    const text = rest.join(' ');
    if (text.length === 0) {
      console.error('usage: todoer add "<text>" [--json]');
      process.exit(2);
    }
    const parsed = parseQuickAdd(text);
    const opId = uuidv7();
    const id = uuidv7();
    const { state, results } = await sync([
      {
        opId, kind: 'create', table: 'task', id,
        fields: { title: parsed.title, priority: parsed.priority, rank: 'a0' },
        ts: new Date().toISOString(),
      },
    ]);
    assertNotRejected(results, opId);
    if (json) {
      console.log(JSON.stringify(state.rows.task?.[id] ?? null));
    } else {
      console.log(parsed.title);
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
    console.error('usage: todoer add "<text>" [--json] | todoer list [--json]');
    process.exit(2);
  }
}

main().catch((error: unknown) => {
  if (error instanceof RefusalError) {
    console.error(error.message);
    process.exit(1);
  }
  if (error instanceof NetworkError) {
    console.error(error.message);
    process.exit(3);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
});
