import type { Result, Write } from '@todoer/client-core';
import type { Draft } from '../db/client';

type Writer = {
  mint(draft: Draft): Write;
  write(write: Write): Promise<Result>;
};

/**
 * One intent at a time: a draft is minted once and its write is held until it
 * is accepted, so sending the same draft again is the same operation (a slow
 * attempt that did apply is replayed, not repeated). A different draft is a
 * new operation. The result carries the write that was sent, so a caller
 * can read the ids it minted (a moved copy's, for its Undo).
 */
export function createIntent(db: Writer) {
  let held: { key: string; write: Write } | undefined;
  return async (draft: Draft): Promise<Result & { write: Write }> => {
    const key = JSON.stringify(draft);
    if (held?.key !== key) held = { key, write: db.mint(draft) };
    const { write } = held;
    const result = await db.write(write);
    if (result.ok && held?.write === write) held = undefined;
    return { ...result, write };
  };
}
