<script setup lang="ts">
import type { Item, Placement, Span, Write } from '@todoer/client-core';
import { createIntent } from '~/utils/intent';

const props = defineProps<{
  today: string;
  span: Span | null;
  items: Item[];
  placements: Placement[];
}>();
const db = useDb();
const route = useRoute();
const router = useRouter();
const openTask = useOpenTask();
const toast = useToast();
const fail = useFail();
const { t, locale } = useI18n();

const state = computed(() => fromQuery(route.query, props.today));
const want = computed(() => gridSpan(state.value.mode, state.value.at));
// The engine answers the span this tab asked for; until then, no stale chips.
const ready = computed(
  () =>
    props.span?.from === want.value.from && props.span?.to === want.value.to,
);

const go = (mode: Mode, at: string) =>
  router.push({ query: { ...route.query, mode, at } });

const utc = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale.value, { ...options, timeZone: 'UTC' });
const at = (date: string) => new Date(`${date}T00:00:00.000Z`);

const title = computed(() => {
  const { mode, at: current } = state.value;
  if (mode === 'month') {
    return utc({ month: 'long', year: 'numeric' }).format(at(current));
  }
  const { from, to } = want.value;
  return utc({ day: 'numeric', month: 'short', year: 'numeric' }).formatRange(
    at(from),
    at(to),
  );
});
const long = computed(() => utc({ dateStyle: 'full' }));
const dates = computed(() => days(want.value));
const heads = computed(() =>
  dates.value.slice(0, 7).map((d) => utc({ weekday: 'short' }).format(at(d))),
);
const items = computed(
  () => new Map(props.items.map((i) => [String(i.id), i])),
);
const byDate = computed(() => {
  const map = new Map<string, Placement[]>();
  for (const p of props.placements) {
    map.set(p.date, [...(map.get(p.date) ?? []), p]);
  }
  return map;
});
const short = computed(() => utc({ day: 'numeric', month: 'short' }));

/** One move intent: a retry after a refusal the server kept no verdict for
 *  resends the same write (one opId, one copy); a recorded refusal drops it,
 *  and a different move mints its own. */
const send = createIntent(db);

/** Drag, menu and dialog end here. True when the core accepted the move
 *  (or nothing had to move). The toast's Undo sends the inverse: the copy's
 *  id comes from the sent write. */
async function move(p: Placement, to: string): Promise<boolean> {
  const item = items.value.get(p.taskId);
  if (!item) return false;
  const plan = placeWrite(p, item, to);
  if (!plan) return true; // already on that day
  const { write: minted, ...result } = await send(plan.write);
  if (!result.ok) {
    fail(result);
    return false;
  }
  const fmt = (date: string) => short.value.format(at(date));
  offerUndo(
    {
      title:
        p.occurrence === null
          ? t('calendar.moved', { to: fmt(to) })
          : t('calendar.movedOccurrence', {
              from: fmt(p.occurrence),
              to: fmt(to),
            }),
      description: String(item.title),
    },
    db.mint(plan.undo(minted as Parameters<typeof plan.undo>[0])),
  );
  return true;
}

/** A toast with Undo. A refused Undo is the failure toast; when the
 *  refusal can pass (a copy not synced yet, one with subtasks) it carries
 *  the same Undo again, so it succeeds once the reason is gone. */
function offerUndo(
  shown: { title: string; description: string; color?: 'error' },
  undo: Write,
) {
  toast.add({
    ...shown,
    actions: [
      {
        label: t('list.undo'),
        // A getter: the toast stays up, and Undo follows the connection.
        get disabled() {
          return !db.connected.value;
        },
        onClick: () =>
          void db.write(undo).then((result) => {
            if (result.ok) return;
            if (!undoable(result.failure)) return fail(result);
            offerUndo(
              {
                color: 'error',
                title: t(`errors.${result.failure.kind}`),
                description: result.failure.detail,
              },
              undo,
            );
          }),
      },
    ],
  });
}

const { over, chipEvents, dayEvents } = useDayDrag(
  (p, to) => void move(p, to),
  () => db.connected.value,
);
const moving = ref<Placement | null>(null);

const month = computed(() => state.value.at.slice(0, 7));
const open = (taskId: string, opener?: HTMLElement) => openTask(taskId, opener);
</script>

<template>
  <div class="@container flex flex-col gap-3" data-testid="calendar">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-chevron-left"
        :aria-label="$t('calendar.previous')"
        @click="go(state.mode, shift(state.mode, state.at, -1))"
      />
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-chevron-right"
        :aria-label="$t('calendar.next')"
        @click="go(state.mode, shift(state.mode, state.at, 1))"
      />
      <UButton variant="outline" color="neutral" @click="go(state.mode, today)">
        {{ $t('calendar.today') }}
      </UButton>
      <h2 class="flex-1 text-lg font-semibold" data-testid="calendar-title">
        {{ title }}
      </h2>
      <UTabs
        :model-value="state.mode"
        :items="[
          { label: $t('calendar.week'), value: 'week' },
          { label: $t('calendar.month'), value: 'month' },
        ]"
        :content="false"
        @update:model-value="go($event as Mode, state.at)"
      />
    </div>
    <div
      v-if="!ready"
      class="grid grid-cols-1 gap-1 @3xl:grid-cols-7"
      data-testid="calendar-skeleton"
    >
      <USkeleton v-for="n in 7" :key="n" class="h-24" />
    </div>
    <template v-else>
      <div
        class="hidden grid-cols-7 gap-1 text-center text-xs text-muted @3xl:grid"
      >
        <span v-for="h in heads" :key="h">{{ h }}</span>
      </div>
      <!-- Seven columns where they fit, a list of dated days where not. -->
      <div class="grid grid-cols-1 gap-1 @3xl:grid-cols-7">
        <CalendarDay
          v-for="d in dates"
          :key="d"
          :date="d"
          :label="long.format(at(d))"
          :today="d === today"
          :muted="state.mode === 'month' && !d.startsWith(month)"
          :limit="state.mode === 'month' ? 3 : null"
          :placements="byDate.get(d) ?? []"
          :items="items"
          :over="over === d"
          :chip-events="chipEvents"
          v-bind="dayEvents(d)"
          @open="open"
          @move="moving = $event"
          @more="go('week', d)"
        />
      </div>
    </template>
    <MoveDateDialog :placement="moving" :apply="move" @close="moving = null" />
  </div>
</template>
