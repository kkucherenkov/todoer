import type { SyncReason } from './protocol';

/**
 * Q14's triggers that live in a tab: every 30 s while visible, on regained
 * focus or visibility, and on `online`. The worker syncs at start by itself,
 * and `write` is sent by W3's write commands. Every tab runs this; the engine
 * drops a `tick` during a run or just after one, so several visible tabs cost
 * little. The interval is not stopped on sign-out: a tick then is refused
 * cheaply in the worker (`signed-out`) and the next sign-in needs no restart.
 */
export function startCadence(
  send: (reason: SyncReason) => void,
  {
    doc = document,
    win = window,
    everyMs = 30_000,
    now = Date.now,
  }: {
    doc?: Pick<
      Document,
      'visibilityState' | 'addEventListener' | 'removeEventListener'
    >;
    win?: EventTarget;
    everyMs?: number;
    now?: () => number;
  } = {},
): () => void {
  const visible = () => doc.visibilityState === 'visible';
  const tick = () => visible() && send('tick');
  // Returning to a tab fires `focus` and `visibilitychange` together: one sync.
  let returned = -Infinity;
  const focus = () => {
    if (now() - returned < 1000) return;
    returned = now();
    send('focus');
  };
  const shown = () => visible() && focus();
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
