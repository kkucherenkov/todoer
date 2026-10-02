<script setup lang="ts">
import type { Item, Placement, Span } from '@todoer/client-core';

const props = defineProps<{
  today: string;
  span: Span | null;
  items: Item[];
  placements: Placement[];
}>();
const route = useRoute();
const router = useRouter();
const { locale } = useI18n();

const state = computed(() => fromQuery(route.query, props.today));
const want = computed(() => gridSpan(state.value.mode, state.value.at));
// The worker answers the span this tab asked for; until then, no stale chips.
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
const month = computed(() => state.value.at.slice(0, 7));
const open = (taskId: string) =>
  router.push({ query: { ...route.query, task: taskId } });
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="calendar">
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
      class="grid grid-cols-1 gap-1 sm:grid-cols-7"
      data-testid="calendar-skeleton"
    >
      <USkeleton v-for="n in 7" :key="n" class="h-24" />
    </div>
    <template v-else>
      <div
        class="hidden grid-cols-7 gap-1 text-center text-xs text-muted sm:grid"
      >
        <span v-for="h in heads" :key="h">{{ h }}</span>
      </div>
      <div
        class="grid gap-1"
        :class="
          state.mode === 'week' ? 'grid-cols-1 sm:grid-cols-7' : 'grid-cols-7'
        "
      >
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
          @open="open"
          @more="go('week', d)"
        />
      </div>
    </template>
  </div>
</template>
