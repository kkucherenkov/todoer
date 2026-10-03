import { useSyncExternalStore } from 'react';
import type { Topic, Topics } from '@todoer/client-core';

/**
 * The engine publishes every topic after every change (it does not diff);
 * this keeps the latest of each and wakes React. `view` and `task` are
 * published per key, so those keep one value per key: the TUI watches one
 * view and at most one task, but a stale publish for the previous key must
 * not overwrite the current one.
 */
export type Topics$ = {
  publish<T extends Topic>(topic: T, value: Topics[T]): void;
  get<T extends Topic>(topic: T): Topics[T] | undefined;
  view(key: string): Topics['view'] | undefined;
  task(id: string): Topics['task'] | undefined;
  /** A property, not a method: `useSyncExternalStore` takes it unbound. */
  subscribe: (listener: () => void) => () => void;
};

export function createTopics(): Topics$ {
  const latest = new Map<Topic, unknown>();
  const views = new Map<string, Topics['view']>();
  const tasks = new Map<string, Topics['task']>();
  const listeners = new Set<() => void>();
  return {
    publish(topic, value) {
      if (topic === 'view') {
        const v = value as Topics['view'];
        views.set(v.key, v);
      } else if (topic === 'task') {
        const t = value as Topics['task'];
        tasks.set(t.id, t);
      } else {
        latest.set(topic, value);
      }
      for (const listener of listeners) listener();
    },
    get: (topic) => latest.get(topic) as never,
    view: (key) => views.get(key),
    task: (id) => tasks.get(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** One topic's latest value; re-renders when anything is published. */
export function useTopic<T extends Topic>(
  topics: Topics$,
  topic: T,
): Topics[T] | undefined {
  return useSyncExternalStore(topics.subscribe, () => topics.get(topic));
}

export function useView(
  topics: Topics$,
  key: string,
): Topics['view'] | undefined {
  return useSyncExternalStore(topics.subscribe, () => topics.view(key));
}

export function useTask(
  topics: Topics$,
  id: string | null,
): Topics['task'] | undefined {
  return useSyncExternalStore(topics.subscribe, () =>
    id === null ? undefined : topics.task(id),
  );
}
