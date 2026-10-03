import { useCallback } from 'react';
import type { Note, Result, Write } from '@todoer/client-core';
import { useTui } from './context.js';

const noteText = (note: Note) =>
  note.next === null
    ? `marked ${note.marked}`
    : `marked ${note.marked} · next ${note.next}`;

/**
 * Every write a screen makes. `build` mints its ids once, here, so the
 * write is one intent however often the engine retries it (ADR 0015 §4).
 * A refusal is said on the status line; being offline is not: the write is
 * queued and the status bar already shows the pending count.
 */
export function useWrite(): (
  build: (newId: () => string) => Write,
) => Promise<Result> {
  const { engine, newId, status } = useTui();
  return useCallback(
    async (build) => {
      const result = await engine.handle(build(newId), 'tui');
      if (!result.ok) {
        if (result.failure.kind !== 'unreachable') {
          status.say({ tone: 'error', text: result.failure.detail });
        }
      } else if (result.note !== undefined) {
        status.say({ tone: 'info', text: noteText(result.note) });
      }
      return result;
    },
    [engine, newId, status],
  );
}
