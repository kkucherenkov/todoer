/**
 * Runs before every spec file in this package, and refuses the whole run if
 * DATABASE_URL points anywhere but a database whose name says it is
 * disposable.
 *
 * The DB-backed specs (auth.service.spec.ts, sync.service.spec.ts) open each
 * test with `deleteMany({})` across six models. That is the right shape for a
 * test — fixtures must not leak between cases — and it is unconditional
 * destruction of whatever database the process happens to be pointed at.
 * During the branch review it was pointed at the development database on 5433
 * and emptied it.
 *
 * The check lives here, not in the two specs that wipe, because a guard a new
 * spec has to remember to opt into is a guard that a new spec will not have.
 * The cost is that a purely in-memory spec (apply-op, the guard, the filter)
 * also refuses to run against a real DATABASE_URL — over-refusing costs a
 * confusing minute, under-refusing costs a database.
 *
 * `_test` as the marker rather than an opt-out variable (`ALLOW_DESTRUCTIVE=1`
 * and friends): a variable exported once in a shell survives into every later
 * command in that shell, including the one run against the wrong database. A
 * name cannot be exported.
 */
export function assertTestDatabase(url: string | undefined): void {
  // Nothing configured: there is no database to destroy, and the DB-backed
  // specs will fail on connect the way they always have.
  if (url === undefined || url === '') return;

  let database: string;
  try {
    database = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
  } catch {
    throw new Error(`DATABASE_URL is not a URL: ${url}`);
  }

  if (database.endsWith('_test')) return;

  throw new Error(
    `DATABASE_URL points at "${database}", which is not a test database.\n` +
      'These specs delete every row of every table in the database they connect to.\n\n' +
      'Create one and point the run at it:\n\n' +
      '  docker exec todoer-dev-postgres-1 createdb -U todoer todoer_test\n' +
      '  DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \\\n' +
      '    pnpm --filter @todoer/backend exec prisma migrate deploy\n\n' +
      'then run the suite with that same DATABASE_URL.',
  );
}

assertTestDatabase(process.env.DATABASE_URL);
