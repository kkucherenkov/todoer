import type { SyncReason } from './protocol';

/**
 * Q14's triggers that live in a tab: every 30 s while visible, on regained
 * focus or visibility, and on `online`. The worker syncs at start by itself,
 * and `write` is sent by W3's write commands. Every tab runs this; the engine
 * drops a `tick` during a run, so several visible tabs cost nothing.
 */
export function startCadence(
  send: (reason: SyncReason) => void,
  {
    doc = document,
    win = window,
    everyMs = 30_000,
  }: {
    doc?: Pick<
      Document,
      'visibilityState' | 'addEventListener' | 'removeEventListener'
    >;
    win?: EventTarget;
    everyMs?: number;
  } = {},
): () => void {
  const visible = () => doc.visibilityState === 'visible';
  const tick = () => visible() && send('tick');
  const focus = () => send('focus');
  const shown = () => visible() && send('focus');
  const online = () => send('online');
  const timer = setInterval(tick, everyMs);
  win.addEventListener('focus', focus);
  win.addEventListener('online', online);
  doc.addEventListener('visibilitychange', shown);
  return () => {
    clearInterval(timer);
    win.removeEventListener('focus', focus);
    win.removeEventListener('online', online);
    doc.removeEventListener('visibilitychange', shown);
  };
}
