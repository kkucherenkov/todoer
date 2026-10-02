<script setup lang="ts">
import type { Item, Placement } from '@todoer/client-core';

const props = defineProps<{
  date: string;
  label: string;
  today: boolean;
  muted: boolean;
  /** null: every placement; a number: that many, then a "+N" button. */
  limit: number | null;
  placements: Placement[];
  items: Map<string, Item>;
}>();
const emit = defineEmits<{ open: [taskId: string]; more: [] }>();

const shown = computed(() =>
  props.limit === null
    ? props.placements
    : props.placements.slice(0, props.limit),
);
const hidden = computed(() => props.placements.length - shown.value.length);
const day = computed(() => Number(props.date.slice(8)));
</script>

<template>
  <div
    role="region"
    class="flex min-h-24 min-w-0 flex-col gap-1 rounded-md border border-default p-1"
    :class="[
      today && 'ring-2 ring-primary',
      muted && 'bg-elevated/50 text-muted',
    ]"
    :aria-label="label"
    :aria-current="today ? 'date' : undefined"
    :data-date="date"
    data-testid="calendar-day"
  >
    <span
      class="text-xs"
      :class="today ? 'font-bold text-primary' : 'text-muted'"
    >
      {{ day }}
    </span>
    <template v-for="p in shown" :key="`${p.taskId}:${p.kind}:${p.occurrence}`">
      <PlacementChip
        v-if="items.get(p.taskId)"
        :placement="p"
        :item="items.get(p.taskId)!"
        @open="emit('open', p.taskId)"
      />
    </template>
    <UButton
      v-if="hidden > 0"
      variant="link"
      color="neutral"
      size="xs"
      data-testid="more"
      @click="emit('more')"
    >
      {{ $t('calendar.more', { n: hidden }) }}
    </UButton>
  </div>
</template>
