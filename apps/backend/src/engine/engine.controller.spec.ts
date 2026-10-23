import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service.js';
import { createApp } from '../create-app.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../testing/reset-database.js';

const prisma = new PrismaService();
const USER = '11111111-1111-1111-1111-111111111111';
const TAB = '0192f000-0000-7000-8000-000000000001';
let app: INestApplication;
let base: string;
let bearer: Record<string, string>;

const engine = (command: unknown, headers = bearer) =>
  fetch(`${base}/api/v1/engine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ tab: TAB, id: 1, command }),
  });

beforeAll(async () => {
  await resetDatabase(prisma);
  await prisma.user.create({
    data: { id: USER, email: 'a@b.c', passwordHash: 'x' },
  });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`;
  const { token } = app.get(AuthService).signWithExpiry(USER);
  bearer = { authorization: `Bearer ${token}` };
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('EngineController over HTTP', () => {
  it('refuses a request without a bearer', async () => {
    const res = await engine({ kind: 'watch', view: null, task: null }, {});
    expect(res.status).toBe(401);
  });

  it('refuses a session command: the page signs in over /auth', async () => {
    const res = await engine({ kind: 'signIn', email: 'a@b.c', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('runs a watch', async () => {
    const res = await engine({ kind: 'watch', view: 'today', task: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('runs a write into Postgres', async () => {
    const id = uuidv7();
    const res = await fetch(`${base}/api/v1/engine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer },
      body: JSON.stringify({
        tab: TAB,
        id: 2,
        command: { kind: 'add', opId: uuidv7(), id, text: 'over http' },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await prisma.task.findUnique({ where: { id } })).toMatchObject({
      userId: USER,
      title: 'over http',
    });
  });

  it('streams the topics, the snapshot first', async () => {
    const abort = new AbortController();
    const res = await fetch(`${base}/api/v1/engine/events?tab=${TAB}`, {
      headers: bearer,
      signal: abort.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) {
      const { value } = await reader.read();
      text += decoder.decode(value, { stream: true });
    }
    abort.abort();
    const first = text.slice(0, text.indexOf('\n\n'));
    expect(first.startsWith('data: ')).toBe(true);
    expect(JSON.parse(first.slice('data: '.length))).toEqual({
      type: 'publish',
      topic: 'engine',
      value: { state: 'ready', reason: null },
      build: 'server',
    });
  });
});
