import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { AppConfig } from '../config/app-config.js';

const prisma = new PrismaService();
const config = {
  jwtSecret: 'test-secret-at-least-32-characters-long',
} as AppConfig;
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

    const { accessToken } = await service.login(
      'a@b.c',
      'correct horse battery',
    );

    expect(service.verify(accessToken)).toBe(id);
  });

  it('refuses a wrong password', async () => {
    await service.register(uuidv7(), 'a@b.c', 'correct horse battery');

    await expect(service.login('a@b.c', 'wrong')).rejects.toThrow();
  });

  it('refuses an unknown address without revealing that it is unknown', async () => {
    await expect(service.login('nobody@b.c', 'anything')).rejects.toThrow(
      /credentials/i,
    );
  });

  it('rejects a token signed with another secret', () => {
    const other = new AuthService(prisma, {
      jwtSecret: 'a-different-secret-32-chars-long!!',
    } as AppConfig);
    const foreign = other.sign('0192-someone');

    expect(() => service.verify(foreign)).toThrow();
  });

  it('throws the exact same error for a wrong password and an unknown address', async () => {
    await service.register(uuidv7(), 'a@b.c', 'correct horse battery');

    const wrongPassword = await service
      .login('a@b.c', 'wrong')
      .catch((e: unknown) => e);
    const unknownAddress = await service
      .login('nobody@b.c', 'anything')
      .catch((e: unknown) => e);

    const a = wrongPassword as { message: string; getStatus(): number };
    const b = unknownAddress as { message: string; getStatus(): number };
    expect(a.message).toBe(b.message);
    expect(a.getStatus()).toBe(b.getStatus());
  });

  it('rejects a token minted without an exp claim, rather than treating it as never expiring', () => {
    // White-box: hand-builds a token the same way sign() does, but omits
    // exp. claims.exp < Date.now() reads as false when exp is undefined, so
    // a naive check would let this token verify forever.
    const payload = Buffer.from(JSON.stringify({ sub: 'someone' })).toString(
      'base64url',
    );
    const mac = createHmac('sha256', config.jwtSecret)
      .update(payload)
      .digest('base64url');

    expect(() => service.verify(`${payload}.${mac}`)).toThrow();
  });

  it('normalizes email case, so a registration with a capital letter can still log in lower-case', async () => {
    const id = uuidv7();
    await service.register(
      id,
      'Mixed.Case@Example.com',
      'correct horse battery',
    );

    const { accessToken } = await service.login(
      'mixed.case@example.com',
      'correct horse battery',
    );

    expect(service.verify(accessToken)).toBe(id);
  });
});
