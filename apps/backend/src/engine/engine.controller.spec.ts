import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from 'uuidv7';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service.js';
import { createApp } from '../create-app.js';
import { EngineController } from './engine.controller.js';
import { EngineHub } from './engine-hub.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../testing/reset-database.js';

const prisma = new PrismaService();
const USER = '11111111-1111-1111-1111-111111111111';
const TTL = 15 * 60_000;
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

  it('refuses a deleted account, the stream included', async () => {
    const gone = '33333333-3333-3333-3333-333333333333';
    const { token } = app.get(AuthService).signWithExpiry(gone);
    const headers = { authorization: `Bearer ${token}` };
    app.get(EngineHub).unload(gone);
    const watching = { kind: 'watch', view: null, task: null };
    expect((await engine(watching, headers)).status).toBe(401);
    const res = await fetch(`${base}/api/v1/engine/events?tab=${TAB}`, {
      headers,
    });
    expect(res.status).toBe(401);
    expect(app.get(EngineHub).loaded(gone)).toBe(false);
  });

  it('refuses a malformed id before it reaches Postgres', async () => {
    const res = await engine({
      kind: 'add',
      opId: 'x',
      id: uuidv7(),
      text: 'bad',
    });
    expect(res.status).toBe(400);
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

describe('EngineController: the stream', () => {
  const events = () => {
    const req = new EventEmitter();
    const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
    const closer = vi.fn();
    const hub = {
      open: vi.fn(() => closer),
      assertLive: vi.fn(),
    } as unknown as EngineHub;
    const auth = {
      verifyWithExpiry: vi.fn(() => ({
        userId: USER,
        expiresAt: new Date(Date.now() + TTL),
      })),
    } as unknown as AuthService;
    const controller = new EngineController(hub, auth);
    controller.events(
      USER,
      TAB,
      {
        ...req,
        on: req.on.bind(req),
        headers: { authorization: 'Bearer t' },
      } as unknown as Request,
      res as unknown as Response,
    );
    return { controller, req, res, closer };
  };

  it('writes a ping comment every 25 s', () => {
    vi.useFakeTimers();
    try {
      const { res } = events();
      vi.advanceTimersByTime(24_999);
      expect(res.write).not.toHaveBeenCalledWith(': ping\n\n');
      vi.advanceTimersByTime(1);
      expect(res.write).toHaveBeenCalledWith(': ping\n\n');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends when its token expires, and not before', () => {
    vi.useFakeTimers();
    try {
      const { res, closer } = events();
      vi.advanceTimersByTime(TTL - 1);
      expect(res.end).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(res.end).toHaveBeenCalledOnce();
      expect(closer).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('registers nothing when the expiry lookup throws', () => {
    vi.useFakeTimers();
    try {
      const open = vi.fn();
      const writeHead = vi.fn();
      const controller = new EngineController(
        { open } as unknown as EngineHub,
        {
          verifyWithExpiry: () => {
            throw new Error('expired');
          },
        } as unknown as AuthService,
      );
      expect(() =>
        controller.events(
          USER,
          TAB,
          { on: vi.fn(), headers: {} } as unknown as Request,
          { writeHead } as unknown as Response,
        ),
      ).toThrow('expired');
      expect(open).not.toHaveBeenCalled();
      expect(writeHead).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a deleted user before it writes the head', () => {
    const open = vi.fn();
    const writeHead = vi.fn();
    const controller = new EngineController(
      {
        open,
        assertLive: () => {
          throw new UnauthorizedException('invalid token');
        },
      } as unknown as EngineHub,
      {
        verifyWithExpiry: () => ({
          userId: USER,
          expiresAt: new Date(Date.now() + TTL),
        }),
      } as unknown as AuthService,
    );
    expect(() =>
      controller.events(
        USER,
        TAB,
        { on: vi.fn(), headers: {} } as unknown as Request,
        { writeHead } as unknown as Response,
      ),
    ).toThrow('invalid token');
    expect(open).not.toHaveBeenCalled();
    expect(writeHead).not.toHaveBeenCalled();
  });

  it('shutting down ends every open stream once', () => {
    const { controller, req, res, closer } = events();
    controller.onModuleDestroy();
    expect(res.end).toHaveBeenCalledOnce();
    // The client's close then finds the stream already ended.
    req.emit('close');
    expect(res.end).toHaveBeenCalledOnce();
    expect(closer).toHaveBeenCalledOnce();
  });
});
