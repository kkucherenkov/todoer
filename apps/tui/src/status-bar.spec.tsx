import { afterEach, describe, expect, it } from 'vitest';
import { StatusBar } from './status-bar.js';
import { renderTui } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

describe('StatusBar', () => {
  it('shows synced, then offline with the pending count', async () => {
    const t = await renderTui(<StatusBar hints="q quit" />);
    cleanup = t.cleanup;
    expect(t.lastFrame()).toMatch(/synced/);
    t.server.state.offline = true;
    await t.engine.handle(
      { kind: 'add', opId: t.newId(), id: t.newId(), text: 'x' },
      'tui',
    );
    // A write's own send does not update `reached`; the next sync does.
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    await t.settle();
    expect(t.lastFrame()).toMatch(/offline · 1 pending/);
  });

  it('shows the status line message over the hints', async () => {
    const t = await renderTui(<StatusBar hints="q quit" />);
    cleanup = t.cleanup;
    t.status.say({ tone: 'error', text: 'no task x' });
    await t.settle();
    expect(t.lastFrame()).toMatch(/no task x/);
    expect(t.lastFrame()).not.toMatch(/q quit/);
  });
});
