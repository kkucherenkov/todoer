const ATTEMPTS = 10;
const FIRST_DELAY_MS = 100;
const MAX_DELAY_MS = 1000;

/** No retry can conjure OPFS up: sqlite-wasm's own text for a browser
 *  without it. */
const permanent = (error: unknown) =>
  error instanceof Error &&
  error.message.startsWith('Missing required OPFS APIs');

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Installs the OPFS pool, retrying while the previous leader's worker still
 * holds its handles (Review Focus 1): ten attempts, 100 ms doubling to 1 s
 * between them, about 6.5 s in all. A browser without OPFS fails at once.
 */
export async function installPool<T>(
  install: () => Promise<T>,
  sleep = wait,
): Promise<T> {
  for (
    let attempt = 1, delay = FIRST_DELAY_MS;
    ;
    attempt++, delay = Math.min(delay * 2, MAX_DELAY_MS)
  ) {
    try {
      return await install();
    } catch (error) {
      if (attempt >= ATTEMPTS || permanent(error)) throw error;
      await sleep(delay);
    }
  }
}

/**
 * sqlite-wasm caches a failed install per VFS name and rethrows it to every
 * later call; without `forceReinitIfPreviouslyFailed` a retry never retries.
 * Its typings omit the option, hence the structural parameter.
 */
export const installOpfsPool = <T>(sqlite3: {
  installOpfsSAHPoolVfs(options: {
    name: string;
    forceReinitIfPreviouslyFailed: boolean;
  }): Promise<T>;
}) =>
  sqlite3.installOpfsSAHPoolVfs({
    name: 'todoer',
    forceReinitIfPreviouslyFailed: true,
  });
