import { NodeSqlite } from './node-sqlite.js';
import { SCHEMA, Store } from './store.js';

/** The CLI's openStore without its file-system concerns (directory and
 *  file modes, umask, retry on a first open), which apps/cli tests. */
export function openStore(path: string): Store {
  const db = new NodeSqlite(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return new Store(db);
}
