import { afterEach, describe, expect, it } from 'vitest';
import { ALL_OPEN, viewTasks } from '@todoer/client-core';
import { fakeServer, renderApp } from './test-kit.js';
import { createWrite } from './write.js';

let cleanup = () => {};
afterEach(() => cleanup());

async function adds(text: string, server = fakeServer()) {
  const t = await renderApp({ server });
  cleanup = t.cleanup;
  const result = await createWrite(t)((newId) => ({
    kind: 'add',
    opId: newId(),
    id: newId(),
    text,
  }));
  await t.settle();
  return { ...t, result };
}

describe('createWrite', () => {
  it('runs the write through the engine', async () => {
    const t = await adds('milk');
    expect(t.result.ok).toBe(true);
    expect(
      viewTasks(t.store, '2026-10-03', ALL_OPEN).map((i) => i.title),
    ).toEqual(['milk']);
  });

  it('says a refusal on the status line', async () => {
    const t = await adds('   ');
    expect(t.result.ok).toBe(false);
    expect(t.status.message?.tone).toBe('error');
  });

  it('says nothing when the server is merely unreachable', async () => {
    // Offline from the start: the write is queued, which is taken.
    const server = fakeServer();
    server.state.offline = true;
    const t = await adds('offline', server);
    expect(t.result.ok).toBe(true);
    expect(t.store.counts().pending).toBe(1);
    expect(t.status.message).toBeNull();
  });
});
