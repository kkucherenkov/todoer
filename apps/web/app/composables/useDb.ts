import type { Db } from '~/db/client';
import type { Topic, Topics } from '~/db/protocol';

/** The tab's database. Non-null under AppGate, which owns the insecure case. */
export const useDb = () => useNuxtApp().$db as Db;

export const useTopic = <T extends Topic>(topic: T) => {
  const db = useDb();
  return computed<Topics[T] | undefined>(() => db.topics[topic].value);
};

/** Watches `view` (and the drawer's `?task=`) while the page is mounted and
 *  as either changes. A page that replaces this one watches its own. */
export function useWatch(view: () => string) {
  const db = useDb();
  const route = useRoute();
  watchEffect(() => {
    const task = route.query.task;
    db.watch(view(), typeof task === 'string' ? task : null);
  });
}
