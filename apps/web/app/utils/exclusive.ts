// Imported, not auto-imported: the spec runs in plain Node.
import { ref } from 'vue';

/** Runs `fn` one call at a time: a call while one runs is dropped, so a
 *  double submit sends one write. `busy` is true meanwhile. */
export function exclusive<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown>,
) {
  const busy = ref(false);
  const run = async (...args: A) => {
    if (busy.value) return;
    busy.value = true;
    try {
      await fn(...args);
    } finally {
      busy.value = false;
    }
  };
  return { busy, run };
}
