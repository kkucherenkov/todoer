import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './create-app.js';
import { PrismaService } from './prisma/prisma.service.js';
import { resetDatabase } from './testing/reset-database.js';

const prisma = new PrismaService();
let app: INestApplication;
let base: string;

const get = (path: string, accept = 'application/json') =>
  fetch(`${base}${path}`, { headers: { accept } });
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await resetDatabase(prisma);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('createApp: the real middleware chain over HTTP', () => {
  it('serves GET /api/v1/health as JSON', async () => {
    const res = await get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('lets a well-formed login body reach the controller (401, not 400)', async () => {
    // Trap 3: a 400 here means the body parser runs after the validator.
    const res = await post('/api/v1/auth/login', {
      email: 'nobody@example.com',
      password: 'correct horse battery staple',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );
  });

  it('rejects a login body missing its fields with 400 from the validator', async () => {
    const res = await post('/api/v1/auth/login', {});
    expect(res.status).toBe(400);
  });

  it('serves nothing at / without WEB_ROOT', async () => {
    const res = await get('/', 'text/html');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );
  });
});
