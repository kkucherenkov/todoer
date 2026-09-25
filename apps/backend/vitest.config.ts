import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every *.spec.ts here that touches PrismaService talks to one real,
    // shared Postgres instance with no per-test schema or transaction
    // isolation (e.g. sync.service.spec.ts and auth.service.spec.ts both
    // fix a user on 'a@b.c'). Running spec files in parallel races those
    // fixtures against each other; serialising files is the fix, not
    // renaming fixtures, since a future spec can collide the same way.
    fileParallelism: false,
  },
});
