export type Message = { tone: 'info' | 'error'; text: string };

/** The one line under the panes: the last thing worth telling, cleared by
 *  the next key a screen handles. */
export type StatusLine = {
  readonly message: Message | null;
  say(message: Message): void;
  clear(): void;
  /** A property, not a method: `useSyncExternalStore` takes it unbound. */
  subscribe: (listener: () => void) => () => void;
};

export function createStatusLine(): StatusLine {
  let message: Message | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Message | null) => {
    message = next;
    for (const listener of listeners) listener();
  };
  return {
    get message() {
      return message;
    },
    say: set,
    clear: () => message !== null && set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
