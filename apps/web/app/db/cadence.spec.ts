import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCadence } from './cadence';
import type { SyncReason } from '@todoer/client-core';

// Fake document and window: an EventTarget each, plus the one field read.
const setup = () => {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const win = new EventTarget();
  const sent: SyncReason[] = [];
  const clock = { at: 0 };
  const stop = startCadence((r) => sent.push(r), {
    doc,
    win,
    now: () => clock.at,
  });
  return { doc, win, sent, stop, clock };
};

describe('startCadence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks every 30 s while visible', () => {
    const { sent } = setup();
    vi.advanceTimersByTime(29_999);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['tick']);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual(['tick', 'tick', 'tick']);
  });

  it('sends nothing on the clock while hidden, and resumes when visible', () => {
    const { doc, sent } = setup();
    doc.visibilityState = 'hidden';
    vi.advanceTimersByTime(90_000);
    expect(sent).toEqual([]);
    doc.visibilityState = 'visible';
    vi.advanceTimersByTime(30_000);
    expect(sent).toEqual(['tick']);
  });

  it('syncs on focus', () => {
    const { win, sent } = setup();
    win.dispatchEvent(new Event('focus'));
    expect(sent).toEqual(['focus']);
  });

  it('syncs when the tab becomes visible, not when it becomes hidden', () => {
    const { doc, sent } = setup();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual([]);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual(['focus']);
  });

  it('sends one sync for the focus and visibility events of one return', () => {
    const { doc, win, sent, clock } = setup();
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual(['focus']);
    clock.at = 1000;
    win.dispatchEvent(new Event('focus'));
    expect(sent).toEqual(['focus', 'focus']);
  });

  it('syncs when the network comes back', () => {
    const { win, sent } = setup();
    win.dispatchEvent(new Event('online'));
    expect(sent).toEqual(['online']);
  });

  it('does not sync on its own at start: the worker does that', () => {
    expect(setup().sent).toEqual([]);
  });

  it('stops everything', () => {
    const { doc, win, sent, stop } = setup();
    stop();
    vi.advanceTimersByTime(90_000);
    win.dispatchEvent(new Event('focus'));
    win.dispatchEvent(new Event('online'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual([]);
  });
});
