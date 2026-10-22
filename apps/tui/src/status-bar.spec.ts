import { visibleWidth } from '@earendil-works/pi-tui';
import type { Topics } from '@todoer/client-core';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from './test-kit.js';
import { renderStatus } from './status-bar.js';

let cleanup = () => {};
afterEach(() => cleanup());

const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

const sync = (over: Partial<Topics['sync']> = {}): Topics['sync'] => ({
  running: false,
  reached: true,
  lastSyncedAt: null,
  pending: 0,
  failed: 0,
  problem: null,
  ...over,
});

const hints = 'j/k move · o new · x done · > < indent · Tab focus · q quit';

describe('renderStatus', () => {
  it('is exactly 2 lines of exactly width cells at 140, 80 and 60', () => {
    for (const width of [140, 80, 60]) {
      const lines = renderStatus(width, {
        mode: 'NORMAL',
        sync: sync({ reached: false, pending: 2, failed: 1 }),
        message: { tone: 'error', text: 'x'.repeat(200) },
        hints: hints.repeat(3),
      });
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(visibleWidth(line)).toBe(width);
    }
  });

  it('shows the mode, then the sync state, then the message', () => {
    const [top] = renderStatus(80, {
      mode: 'INSERT',
      sync: sync(),
      message: { tone: 'info', text: 'marked done' },
      hints,
    }).map(plain);
    expect(top).toMatch(/^INSERT · synced · marked done/);
  });

  it('counts queued and refused writes', () => {
    const top = (s: Topics['sync']) =>
      plain(
        renderStatus(80, { mode: 'NORMAL', sync: s, message: null, hints })[0],
      );
    expect(top(sync({ pending: 3 }))).toContain('NORMAL · 3 queued');
    expect(top(sync({ failed: 2 }))).toContain('synced · 2 refused');
    expect(top(sync({ reached: false, pending: 2 }))).toContain(
      'offline · 2 queued',
    );
  });

  it('cuts the hints at the right with …, never wrapping', () => {
    const [, bottom] = renderStatus(30, {
      mode: 'NORMAL',
      sync: sync(),
      message: null,
      hints,
    }).map(plain);
    expect(bottom).toMatch(/…\s*$/);
    expect(bottom?.startsWith(hints.slice(0, 20))).toBe(true);
  });

  it('shows offline with the queued count from the engine', async () => {
    const t = await renderApp();
    cleanup = t.cleanup;
    const top = () =>
      plain(
        renderStatus(80, {
          mode: 'NORMAL',
          sync: t.topics.get('sync'),
          message: null,
          hints,
        })[0],
      );
    expect(top()).toMatch(/synced/);
    t.server.state.offline = true;
    await t.engine.handle(
      { kind: 'add', opId: t.newId(), id: t.newId(), text: 'x' },
      'tui',
    );
    // A write's own send does not update `reached`; the next sync does.
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    await t.settle();
    expect(top()).toMatch(/offline · 1 queued/);
  });
});
