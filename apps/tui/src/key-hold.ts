import { useContext, useEffect, useSyncExternalStore } from 'react';
import { TuiContext } from './context.js';

/**
 * Whether a line being typed or a picker owns the keyboard. Ink hands every
 * key to every active `useInput`, so without this `q` typed into a task's
 * title would also quit. The widgets hold it while mounted; `App`'s global
 * keys yield while it is held.
 */
export type KeyHold = {
  readonly held: boolean;
  /** Returns the release. */
  hold(): () => void;
  /** A property, not a method: `useSyncExternalStore` takes it unbound. */
  subscribe: (listener: () => void) => () => void;
};

export function createKeyHold(): KeyHold {
  let holders = 0;
  const listeners = new Set<() => void>();
  const set = (next: number) => {
    holders = next;
    for (const listener of listeners) listener();
  };
  return {
    get held() {
      return holders > 0;
    },
    hold() {
      set(holders + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        set(holders - 1);
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Holds the keyboard while the calling widget is mounted. A no-op outside
 *  `TuiContext`, so a widget renders on its own in a spec. */
export function useHoldKeys(): void {
  const keys = useContext(TuiContext)?.keys;
  useEffect(() => keys?.hold(), [keys]);
}

export function useKeysHeld(keys: KeyHold): boolean {
  return useSyncExternalStore(keys.subscribe, () => keys.held);
}
