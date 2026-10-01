import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { sqlDatabaseContract } from './sql-database.contract.js';
import { flush } from './sync.js';
import { openWasmStore, WasmSqlite } from './sqlite-wasm.js';

let sqlite3: Sqlite3Static;

beforeAll(async () => {
  // The typings declare init() without arguments; at run time it takes the
  // Emscripten module overrides.
  const init = sqlite3InitModule as (m: object) => Promise<Sqlite3Static>;
  sqlite3 = await init({ print() {}, printErr() {} });
});

sqlDatabaseContract(
  'WasmSqlite',
  () => new WasmSqlite(new sqlite3.oo1.DB(':memory:', 'c'), sqlite3.capi),
);

describe('WasmSqlite', () => {
  it('names the re-entry it refuses', async () => {
    const db = new WasmSqlite(
      new sqlite3.oo1.DB(':memory:', 'c'),
      sqlite3.capi,
    );
    await expect(
      db.withWriteLock(() => db.withWriteLock(() => Promise.resolve())),
    ).rejects.toThrow('withWriteLock called while a lock body runs');
  });
});

describe('openWasmStore', () => {
  it('applies the schema and merges a pulled page', async () => {
    const store = openWasmStore(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'));
    const body = {
      cursor: 7,
      results: [],
      changes: [
        { table: 'task', id: 'a', seq: 6, row: { id: 'a', title: 'one' } },
        { table: 'task', id: 'b', seq: 7, row: { id: 'b', title: 'two' } },
      ],
    };
    const flushed = await flush(store, () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    expect(flushed.synced).toBe(true);
    expect(store.rows('task')).toEqual([
      { id: 'a', title: 'one' },
      { id: 'b', title: 'two' },
    ]);
    expect(store.cursor()).toBe(7);
    store.close();
  });
});
