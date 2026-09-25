import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { AppConfig } from '../config/app-config.js';

const prisma = new PrismaService();
const config = { jwtSecret: 'test-secret-at-least-32-characters-long' } as AppConfig;
const service = new AuthService(prisma, config);

beforeEach(async () => {
  // Same order as sync.service.spec.ts's cleanup: userId is ON DELETE
  // RESTRICT on Task/Project/Tag/TaskTag, so a fixture left behind by that
  // suite — sharing this same Postgres instance, serialized into the same
  // worker pool by vitest.config.ts's fileParallelism: false — would
  // otherwise block deleting the user that owns it, and which spec file
  // runs first is not guaranteed.
  await prisma.appliedOp.deleteMany({});
  await prisma.taskTag.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.user.deleteMany({});
});

describe('AuthService', () => {
  it('issues a token the guard accepts, carrying the user id', async () => {
    const id = uuidv7();
    await service.register(id, 'a@b.c', 'correct horse battery');

    const { accessToken } = await service.login('a@b.c', 'correct horse battery');

    expect(service.verify(accessToken)).toBe(id);
  });

  it('refuses a wrong password', async () => {
    await service.register(uuidv7(), 'a@b.c', 'correct horse battery');

    await expect(service.login('a@b.c', 'wrong')).rejects.toThrow();
  });

  it('refuses an unknown address without revealing that it is unknown', async () => {
    await expect(service.login('nobody@b.c', 'anything')).rejects.toThrow(/credentials/i);
  });

  it('rejects a token signed with another secret', () => {
    const other = new AuthService(prisma, { jwtSecret: 'a-different-secret-32-chars-long!!' } as AppConfig);
    const foreign = other.sign('0192-someone');

    expect(() => service.verify(foreign)).toThrow();
  });
});
