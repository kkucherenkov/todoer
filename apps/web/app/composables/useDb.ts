import type { Db } from '~/db/client';
import type { Topic, Topics } from '@todoer/client-core';

/** The tab's database. Non-null under AppGate, which owns the insecure case. */
export const useDb = () => useNuxtApp().$db as Db;

export const useTopic = <T extends Topic>(topic: T) => {
  const db = useDb();
  return computed<Topics[T] | undefined>(() => db.topics[topic].value);
};

/** Watches `view` (and the drawer's `?task=`, the `?layout=` override, and
 *  a calendar's span) while the page is mounted and as any changes. A page
 *  that replaces this one watches its own. */
export function useWatch(view: () => string) {
  const db = useDb();
  const route = useRoute();
  const catalog = useTopic('catalog');
  // The worker's date, kept apart from the view topic: a watch with a new
  // span clears that topic, and a span derived from it would never settle.
  const shown = useTopic('view');
  const today = ref<string>();
  watch(shown, (v) => v && (today.value = v.today));
  watchView(
    (key, task, span, layout) => db.watch(key, task, span, layout),
    view,
    () => catalog.value?.views,
    () => route.query,
    () => today.value,
  );
}
