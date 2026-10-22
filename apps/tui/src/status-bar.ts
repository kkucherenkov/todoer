import { truncateToWidth } from '@earendil-works/pi-tui';
import type { Topics } from '@todoer/client-core';
import type { Message } from './status-line.js';
import { colour, sgr } from './style.js';

export type InputMode = 'NORMAL' | 'INSERT';

const syncText = (sync: Topics['sync'] | undefined) => {
  if (sync === undefined) return 'starting';
  const state = sync.running
    ? 'syncing…'
    : sync.reached === false
      ? 'offline'
      : sync.pending > 0
        ? null
        : 'synced';
  return [
    state,
    sync.pending > 0 ? `${String(sync.pending)} queued` : null,
    sync.failed > 0 ? `${String(sync.failed)} refused` : null,
  ]
    .filter((s) => s !== null)
    .join(' · ');
};

/**
 * The two lines under the panes. The first is the mode, the sync state and
 * the status line's message; the second the hints for the focus. Each is
 * exactly `width` cells, cut at the right with `…`, never wrapped.
 */
export function renderStatus(
  width: number,
  s: {
    mode: InputMode;
    sync: Topics['sync'] | undefined;
    message: Message | null;
    hints: string;
  },
): [string, string] {
  // An error is marked with ✗, not by its colour alone.
  const message =
    s.message === null
      ? []
      : s.message.tone === 'error'
        ? [colour() ? sgr(31, `✗ ${s.message.text}`) : `✗ ${s.message.text}`]
        : [s.message.text];
  const top = [sgr(1, s.mode), syncText(s.sync), ...message].join(' · ');
  return [
    truncateToWidth(top, width, '…', true),
    truncateToWidth(sgr(2, s.hints), width, '…', true),
  ];
}
