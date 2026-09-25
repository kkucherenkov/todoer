#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { parseQuickAdd } from './parse-quick-add.js';
import { BASE, TOKEN, STATE } from './config.js';

type State = { cursor: number; rows: Record<string, Record<string, unknown>> };

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

async function sync(ops: unknown[]): Promise<State> {
  const state = await load();
  const response = await fetch(`${BASE}/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ since: state.cursor, ops }),
  });
  if (!response.ok) {
    throw new Error(`sync failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    cursor: number;
    changes: Array<{ id: string; row: Record<string, unknown> }>;
  };
  for (const change of body.changes) state.rows[change.id] = change.row;
  state.cursor = body.cursor;
  await save(state);
  return state;
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'add') {
  const parsed = parseQuickAdd(rest.join(' '));
  await sync([
    {
      opId: uuidv7(), kind: 'create', table: 'task', id: uuidv7(),
      fields: { title: parsed.title, priority: parsed.priority, rank: 'a0' },
      ts: new Date().toISOString(),
    },
  ]);
  console.log(parsed.title);
} else if (command === 'list') {
  const state = await sync([]);
  for (const row of Object.values(state.rows)) {
    if (row.deletedAt !== null) continue;
    console.log(`${String(row.priority)}  ${String(row.title)}`);
  }
} else {
  console.error('usage: todoer add "<text>" | todoer list');
  process.exit(2);
}
