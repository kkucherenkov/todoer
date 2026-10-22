import type { Failure } from '@todoer/client-core';

/** No verdict was kept for the write (no answer, an unexpected error, the
 *  session not ready, or a refusal the server did not record): `r` sends it
 *  again under the same opId, which cannot apply twice. A recorded refusal
 *  or input the core turned down is for good: only a new write can land. */
export const retryable = (f: Failure): boolean =>
  f.kind === 'refused'
    ? f.retryable === true
    : f.kind === 'unavailable' ||
      f.kind === 'unexpected' ||
      f.kind === 'unreachable' ||
      f.kind === 'signed-out';
