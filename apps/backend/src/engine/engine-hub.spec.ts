import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import type { FromWorker } from '@todoer/client-core';
import { AuthService } from '../auth/auth.service.js';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChangeFeed } from '../sync/change-feed.js';
import { SyncService } from '../sync/sync.service.js';
import { resetDatabase } from '../testing/reset-database.js';
import { EngineHub, UNLOAD_MS } from './engine-hub.js';

const prisma = new PrismaService();
const U = '11111111-1111-1111-1111-111111111111';
const V = '22222222-2222-2222-2222-222222222222';
const T1 = '0192f000-0000-7000-8000-000000000001';
const T2 = '0192f000-0000-7000-8000-000000000002';

let feed: ChangeFeed;
let sync: SyncService;
let hub: EngineHub;

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.user.createMany({
    data: [
      { id: U, email: 'u@b.c', passwordHash: 'x' },
      { id: V, email: 'v@b.c', passwordHash: 'x' },
    ],
  });
  feed = new ChangeFeed();
  sync = new SyncService(prisma, feed);
  hub = new EngineHub(sync, feed, new AuthService(prisma, new AppConfig()));
});

const settle = (user: string) =>
  hub.request(user, T1, 999, { kind: 'sync', reason: 'manual' });

// A sync still running would meet the next test's reset (a foreign-key
// error) or a closed replica: let each loaded engine finish first.
afterEach(async () => {
  vi.useRealTimers();
  for (const user of [U, V]) if (hub.loaded(user)) await settle(user);
});

/** A stream that records every event it is sent. */
const stream = (user: string, tab: string) => {
  const events: FromWorker[] = [];
  const close = hub.open(user, tab, (e) => events.push(e));
  const views = (key: string) =>
    events.filter(
      (e) => e.type === 'publish' && e.topic === 'view' && e.value.key === key,
    );
  return { events, close, views };
};

const add = (text: string) => ({
  kind: 'add' as const,
  opId: uuidv7(),
  id: uuidv7(),
  text,
});
const watch = (view: string | null) => ({
  kind: 'watch' as const,
  view,
  task: null,
});

describe('EngineHub', () => {
  it('the first request loads the engine signed in', async () => {
    expect(await hub.request(U, T1, 1, watch('today'))).toEqual({ ok: true });
    const { events } = stream(U, T1);
    expect(events[0]).toMatchObject({
      type: 'publish',
      topic: 'engine',
      value: { state: 'ready' },
      build: 'server',
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        topic: 'session',
        value: { state: 'signed-in', reason: null },
      }),
    );
  });

  it('a write lands in Postgres', async () => {
    const write = add('buy milk');
    expect(await hub.request(U, T1, 1, write)).toEqual({ ok: true });
    const task = await prisma.task.findUnique({ where: { id: write.id } });
    expect(task).toMatchObject({ userId: U, title: 'buy milk' });
  });

  it('a sync by another client reaches the stream', async () => {
    const { views } = stream(U, T1);
    await hub.request(U, T1, 1, watch('all'));
    const id = uuidv7();
    await sync.sync(U, {
      since: 0,
      ops: [
        {
          opId: uuidv7(),
          kind: 'create',
          table: 'task',
          id,
          fields: { title: 'from the cli', rank: 'a0' },
          ts: new Date().toISOString(),
        },
      ],
    });
    await vi.waitFor(() =>
      expect(
        views('all').some(
          (e) =>
            e.type === 'publish' &&
            e.topic === 'view' &&
            e.value.items.some((i) => i.id === id),
        ),
      ).toBe(true),
    );
  });

  it("closing a stream withdraws its tab's watch", async () => {
    const one = stream(U, T1);
    const two = stream(U, T2);
    await hub.request(U, T1, 1, watch('today'));
    one.close();
    const before = two.views('today').length;
    await hub.request(U, T2, 1, add('after the close'));
    expect(two.views('today')).toHaveLength(before);
  });

  it('closing the last stream unloads after the delay', async () => {
    const { close } = stream(U, T1);
    await hub.request(U, T1, 1, watch('today'));
    expect(hub.loaded(U)).toBe(true);
    vi.useFakeTimers();
    close();
    vi.advanceTimersByTime(UNLOAD_MS - 1);
    expect(hub.loaded(U)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hub.loaded(U)).toBe(false);
  });

  it('a request after unload loads the engine again', async () => {
    const { close } = stream(U, T1);
    await settle(U);
    vi.useFakeTimers();
    close();
    vi.advanceTimersByTime(UNLOAD_MS);
    vi.useRealTimers();
    expect(hub.loaded(U)).toBe(false);
    const write = add('again');
    expect(await hub.request(U, T1, 1, write)).toEqual({ ok: true });
    expect(hub.loaded(U)).toBe(true);
    expect(await prisma.task.count({ where: { id: write.id } })).toBe(1);
  });

  it('an unloaded engine no longer hears the feed', async () => {
    const { close } = stream(U, T1);
    await settle(U);
    const listeners = (feed as unknown as { listeners: Map<string, unknown> })
      .listeners;
    expect(listeners.has(U)).toBe(true);
    vi.useFakeTimers();
    close();
    vi.advanceTimersByTime(UNLOAD_MS);
    expect(listeners.has(U)).toBe(false);
  });

  it('a write the server did not take fails and is never resent', async () => {
    await settle(U);
    vi.spyOn(sync, 'sync').mockRejectedValueOnce(new Error('db down'));
    const lost = add('lost');
    expect(await hub.request(U, T1, 1, lost)).toMatchObject({
      ok: false,
      failure: { kind: 'unexpected' },
    });
    expect(await hub.request(U, T1, 2, add('kept'))).toEqual({ ok: true });
    expect(await prisma.task.count({ where: { id: lost.id } })).toBe(0);
    expect(await prisma.task.count({ where: { title: 'kept' } })).toBe(1);
  });

  it('two users never share an engine', async () => {
    const u = stream(U, T1);
    const v = stream(V, T1);
    await hub.request(U, T1, 1, watch('all'));
    await hub.request(V, T1, 1, watch('all'));
    const write = add('only for u');
    await hub.request(U, T1, 2, write);
    const listed = (s: typeof u) =>
      s
        .views('all')
        .some(
          (e) =>
            e.type === 'publish' &&
            e.topic === 'view' &&
            e.value.items.some((i) => i.id === write.id),
        );
    expect(listed(u)).toBe(true);
    expect(listed(v)).toBe(false);
    expect(
      await prisma.task.findUnique({ where: { id: write.id } }),
    ).toMatchObject({ userId: U });
  });
});
