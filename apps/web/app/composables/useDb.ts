import type { Db } from '~/db/client';
import type { Span } from '@todoer/client-core';
import type { Topic, Topics } from '~/db/protocol';

/** The tab's database. Non-null under AppGate, which owns the insecure case. */
export const useDb = () => useNuxtApp().$db as Db;

export const useTopic = <T extends Topic>(topic: T) => {
  const db = useDb();
  return computed<Topics[T] | undefined>(() => db.topics[topic].value);
};

/** Watches `view` (and the drawer's `?task=`, and a calendar's `span`) while
 *  the page is mounted and as any changes. A page that replaces this one
 *  watches its own. */
export function useWatch(view: () => string, span?: () => Span | null) {
  const db = useDb();
  const route = useRoute();
  watchEffect(() => {
    const task = route.query.task;
    db.watch(view(), typeof task === 'string' ? task : null, span?.() ?? null);
  });
}
