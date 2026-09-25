import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Refuses the run when DATABASE_URL is not a test database — see the file
    // itself for why the check is here rather than in the specs that wipe.
    setupFiles: ['./vitest.setup.ts'],
    // Every *.spec.ts here that touches PrismaService talks to one real,
    // shared Postgres instance with no per-test schema or transaction
    // isolation (e.g. sync.service.spec.ts and auth.service.spec.ts both
    // fix a user on 'a@b.c'). Running spec files in parallel races those
    // fixtures against each other; serialising files is the fix, not
    // renaming fixtures, since a future spec can collide the same way.
    fileParallelism: false,
  },
});
