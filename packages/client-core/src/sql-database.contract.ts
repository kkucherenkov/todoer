import { describe, expect, it } from 'vitest';
import type { SqlDatabase } from './store.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** What every SqlDatabase adapter promises Store. A spec helper, excluded
 *  from the build like test-store.ts. */
export function sqlDatabaseContract(
  name: string,
  open: () => SqlDatabase | Promise<SqlDatabase>,
  // NodeSqlite waits for other *processes* by polling; two callers on one
  // connection are not something it queues, so it opts out of the overlap case.
  { queuesInProcess = true } = {},
): void {
  describe(`SqlDatabase contract: ${name}`, () => {
    const fresh = async () => {
      const db = await open();
      db.exec('CREATE TABLE t (a INTEGER, b TEXT)');
      return db;
    };

    it('binds params in run and all, and works without any', async () => {
      const db = await fresh();
      db.run('INSERT INTO t VALUES (?, ?)', [1, 'x']);
      db.run('INSERT INTO t VALUES (2, ?)', ['y']);
      db.run("INSERT INTO t VALUES (3, 'z')");
      db.run("INSERT INTO t VALUES (4, 'w')", []);
      expect(db.all('SELECT a FROM t WHERE b = ?', ['y'])).toEqual([{ a: 2 }]);
      expect(db.all('SELECT a FROM t WHERE a = 1', [])).toEqual([{ a: 1 }]);
      expect(db.all('SELECT count(*) AS n FROM t')).toEqual([{ n: 4 }]);
      expect(db.all('SELECT b FROM t WHERE a = 1', undefined)).toEqual([
        { b: 'x' },
      ]);
    });

    it('returns plain column-keyed objects', async () => {
      const db = await fresh();
      db.run('INSERT INTO t VALUES (?, ?)', [1, 'x']);
      expect(db.all('SELECT a, b FROM t')).toEqual([{ a: 1, b: 'x' }]);
    });

    it('reports inTransaction', async () => {
      const db = await fresh();
      expect(db.inTransaction).toBe(false);
      db.exec('BEGIN');
      expect(db.inTransaction).toBe(true);
      db.exec('COMMIT');
      expect(db.inTransaction).toBe(false);
      db.exec('BEGIN');
      db.exec('ROLLBACK');
      expect(db.inTransaction).toBe(false);
    });

    it('commits on resolve and rolls back on reject', async () => {
      const db = await fresh();
      await db.withWriteLock(() => {
        db.run('INSERT INTO t VALUES (1, ?)', ['kept']);
        return Promise.resolve();
      });
      await expect(
        db.withWriteLock(() => {
          db.run('INSERT INTO t VALUES (2, ?)', ['lost']);
          return Promise.reject(new Error('boom'));
        }),
      ).rejects.toThrow('boom');
      expect(db.inTransaction).toBe(false);
      expect(db.all('SELECT b FROM t')).toEqual([{ b: 'kept' }]);
    });

    it.skipIf(!queuesInProcess)(
      'runs overlapping write locks one after the other',
      async () => {
        const db = await fresh();
        const log: string[] = [];
        const turn = (id: string) =>
          db.withWriteLock(async () => {
            log.push(`${id} start`);
            await tick();
            db.run('INSERT INTO t VALUES (1, ?)', [id]);
            log.push(`${id} end`);
          });
        await Promise.all([turn('first'), turn('second')]);
        expect(log).toEqual([
          'first start',
          'first end',
          'second start',
          'second end',
        ]);
        expect(db.all('SELECT b FROM t ORDER BY rowid')).toEqual([
          { b: 'first' },
          { b: 'second' },
        ]);
      },
    );

    // On one connection the inner call can only wait for the outer body,
    // which is waiting for it: refused, never a silent hang.
    it('refuses a write lock taken from inside a lock body', async () => {
      const db = await fresh();
      await expect(
        db.withWriteLock(() => db.withWriteLock(() => Promise.resolve())),
      ).rejects.toThrow();
      expect(db.inTransaction).toBe(false);
      await db.withWriteLock(() => Promise.resolve());
    });

    it('propagates the original error when the body ended the transaction', async () => {
      const db = await fresh();
      await expect(
        db.withWriteLock(() => {
          db.exec('ROLLBACK');
          return Promise.reject(new Error('original'));
        }),
      ).rejects.toThrow('original');
    });
  });
}
