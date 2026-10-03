import { Text } from 'ink';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_OPEN, viewTasks } from '@todoer/client-core';
import { fakeServer, renderTui } from './test-kit.js';
import { useWrite } from './use-write.js';

let cleanup = () => {};
afterEach(() => cleanup());

function Adds({ text }: { text: string }) {
  const write = useWrite();
  const [done, setDone] = useState('');
  useEffect(() => {
    void write((newId) => ({
      kind: 'add',
      opId: newId(),
      id: newId(),
      text,
    })).then((r) => setDone(r.ok ? 'ok' : 'failed'));
  }, []);
  return <Text>{done}</Text>;
}

describe('useWrite', () => {
  it('runs the write through the engine', async () => {
    const t = await renderTui(<Adds text="milk" />);
    cleanup = t.cleanup;
    await t.settle();
    expect(t.lastFrame()).toBe('ok');
    expect(
      viewTasks(t.store, '2026-10-03', ALL_OPEN).map((i) => i.title),
    ).toEqual(['milk']);
  });

  it('says a refusal on the status line', async () => {
    const t = await renderTui(<Adds text="   " />);
    cleanup = t.cleanup;
    await t.settle();
    expect(t.lastFrame()).toBe('failed');
    expect(t.status.message?.tone).toBe('error');
  });

  it('says nothing when the server is merely unreachable', async () => {
    // Offline from the start: the write is queued, which is taken.
    const server = fakeServer();
    server.state.offline = true;
    const t = await renderTui(<Adds text="offline" />, { server });
    cleanup = t.cleanup;
    await t.settle();
    expect(t.lastFrame()).toBe('ok');
    expect(t.store.counts().pending).toBe(1);
    expect(t.status.message).toBeNull();
  });
});
