/**
 * Deletes everything the old version kept in the origin's private file
 * system: the replica, its journal, the pool's files (design, "Clearing what
 * the browser kept"). Never throws: Firefox rejects `getDirectory()` with
 * `UnknownError` on a broken profile, which is how this work started. True
 * when nothing is left, so a removal that failed (another old tab still holds
 * a file) is tried again on the next load.
 */
/** The part of a directory handle used here; the app's lib has no async
 *  iteration of handles. */
type Directory = {
  keys(): AsyncIterable<string>;
  removeEntry(name: string, options: { recursive: boolean }): Promise<void>;
};

export async function forgetOpfs(storage?: {
  getDirectory(): Promise<unknown>;
}): Promise<boolean> {
  try {
    const root = (await (
      storage ?? navigator.storage
    ).getDirectory()) as Directory;
    let left = false;
    for await (const name of root.keys()) {
      await root
        .removeEntry(name, { recursive: true })
        .catch(() => (left = true));
    }
    return !left;
  } catch {
    return false;
  }
}
