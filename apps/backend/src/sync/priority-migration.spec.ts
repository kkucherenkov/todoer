import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../testing/reset-database.js';

const prisma = new PrismaService();
const USER = '11111111-1111-1111-1111-111111111111';
const TAG = '22222222-2222-2222-2222-222222222222';
const MIGRATION = new URL(
  '../../prisma/migrations/20261021120000_priority_p0_highest/migration.sql',
  import.meta.url,
);

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.user.create({
    data: { id: USER, email: 'a@b.c', passwordHash: 'x' },
  });
});

// `db execute` takes the whole file: it has several statements and a
// function body, which $executeRawUnsafe (one statement) would refuse.
function migrate() {
  execFileSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'db',
      'execute',
      '--file',
      MIGRATION.pathname,
      '--url',
      process.env.DATABASE_URL!,
    ],
    { env: process.env, stdio: 'pipe' },
  );
}

async function insertTask(priority: number, deleted = false) {
  const id = uuidv7();
  await prisma.$executeRaw`
    INSERT INTO "Task" ("id", "userId", "title", "rank", "priority", "deletedAt", "updatedAt")
    VALUES (${id}::uuid, ${USER}::uuid, 't', 'a0', ${priority},
            ${deleted ? new Date() : null}, CURRENT_TIMESTAMP)`;
  return id;
}

async function insertView(filter: unknown) {
  const id = uuidv7();
  await prisma.$executeRaw`
    INSERT INTO "View" ("id", "userId", "name", "layout", "filter", "sort", "rank", "updatedAt")
    VALUES (${id}::uuid, ${USER}::uuid, 'v', 'list', ${JSON.stringify(filter)}::jsonb,
            'rank', 'a0', CURRENT_TIMESTAMP)`;
  return id;
}

describe('migration priority_p0_highest (ADR 0019)', () => {
  it('maps every task, tombstones included, to 4 − old with a new seq and version', async () => {
    const ids = [
      ...(await Promise.all([0, 1, 2, 3, 4].map((p) => insertTask(p)))),
      await insertTask(1, true),
    ];
    const read = () =>
      prisma.task
        .findMany({ where: { id: { in: ids } } })
        .then((rows) => ids.map((id) => rows.find((r) => r.id === id)!));
    const before = await read();

    migrate();

    const after = await read();
    expect(after.map((t) => t.priority)).toEqual([4, 3, 2, 1, 0, 3]);
    after.forEach((t, i) => {
      expect(t.seq).toBeGreaterThan(before[i]!.seq);
      expect(t.version).toBe(before[i]!.version + 1);
      expect(t.fieldTs).toEqual(before[i]!.fieldTs);
    });
    expect(after[5]!.deletedAt).not.toBeNull();
  });

  it('maps priority leaves anywhere in a view filter', async () => {
    const tag = { tag: TAG };
    const cases: [unknown, unknown][] = [
      [{ priority: [4, 0] }, { priority: [0, 4] }],
      [{ priority: [3, 4] }, { priority: [0, 1] }],
      [{ and: [tag, { priority: [1] }] }, { and: [tag, { priority: [3] }] }],
      [
        { not: { or: [{ priority: [2, 3] }] } },
        { not: { or: [{ priority: [1, 2] }] } },
      ],
      [
        { or: [{ and: [{ not: { priority: [0] } }] }] },
        { or: [{ and: [{ not: { priority: [4] } }] }] },
      ],
    ];
    const ids = await Promise.all(cases.map(([f]) => insertView(f)));
    const before = await prisma.view.findMany({ where: { id: { in: ids } } });

    migrate();

    const after = await prisma.view.findMany({ where: { id: { in: ids } } });
    cases.forEach(([, expected], i) => {
      const b = before.find((v) => v.id === ids[i])!;
      const a = after.find((v) => v.id === ids[i])!;
      expect(a.filter).toEqual(expected);
      expect(a.seq).toBeGreaterThan(b.seq);
      expect(a.version).toBe(b.version + 1);
    });
  });

  it('leaves a view without a priority leaf alone', async () => {
    const filter = { and: [{ tag: TAG }, { due: { to: 0 } }] };
    const id = await insertView(filter);
    const before = await prisma.view.findUniqueOrThrow({ where: { id } });

    migrate();

    const after = await prisma.view.findUniqueOrThrow({ where: { id } });
    expect(after.filter).toEqual(filter);
    expect(after.seq).toBe(before.seq);
    expect(after.version).toBe(before.version);
  });

  it('defaults a new task to 4', async () => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 0',
    );
    migrate();
    const id = uuidv7();
    await prisma.$executeRaw`
      INSERT INTO "Task" ("id", "userId", "title", "rank", "updatedAt")
      VALUES (${id}::uuid, ${USER}::uuid, 't', 'a0', CURRENT_TIMESTAMP)`;
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id } })).priority,
    ).toBe(4);
  });
});
