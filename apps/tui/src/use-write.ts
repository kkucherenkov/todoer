import { useMemo } from 'react';
import type { Result, Write } from '@todoer/client-core';
import { useTui } from './context.js';
import { createWrite } from './write.js';

/** `createWrite` over the context's `Tui`, for the Ink screens. */
export function useWrite(): (
  build: (newId: () => string) => Write,
) => Promise<Result> {
  const { engine, newId, status } = useTui();
  return useMemo(
    () => createWrite({ engine, newId, status }),
    [engine, newId, status],
  );
}
