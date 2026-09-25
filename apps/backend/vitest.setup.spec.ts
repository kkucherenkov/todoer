import { describe, expect, it } from 'vitest';
import { assertTestDatabase } from './vitest.setup.js';

describe('assertTestDatabase', () => {
  it('accepts a database whose name marks it as disposable', () => {
    expect(() =>
      assertTestDatabase(
        'postgresql://todoer:todoer@localhost:5433/todoer_test',
      ),
    ).not.toThrow();
  });

  it('refuses the database a developer runs the application against', () => {
    expect(() =>
      assertTestDatabase('postgresql://todoer:todoer@localhost:5433/todoer'),
    ).toThrow(/not a test database/);
  });

  // The guard reads the path, so a name that merely contains the marker
  // somewhere else — a host, a user, a query parameter — must not pass it.
  it('is not fooled by _test anywhere but the database name', () => {
    expect(() =>
      assertTestDatabase(
        'postgresql://todoer_test:todoer@localhost:5433/todoer?x=_test',
      ),
    ).toThrow(/not a test database/);
  });

  it('says nothing about a run that has no database to destroy', () => {
    expect(() => assertTestDatabase(undefined)).not.toThrow();
  });

  it('refuses a DATABASE_URL it cannot parse rather than guessing', () => {
    expect(() => assertTestDatabase('not-a-url')).toThrow(/DATABASE_URL/);
  });
});
