<script setup lang="ts">
import type { Catalog, Item } from '@todoer/client-core';

const props = defineProps<{
  status: Catalog['statuses'][number];
  columns: Catalog['statuses'];
  /** The cards `displayStatus` puts here, in the view's order. */
  items: Item[];
  /** Every card of the board: a drop may come from another column. */
  all: Item[];
  manual: boolean;
}>();
const emit = defineEmits<{
  /** `statusId` undefined: a reorder only; `after` undefined: no rank. */
  move: [item: Item, statusId?: string, after?: string | null];
  open: [item: Item];
}>();

const ids = computed(() => props.items.map((i) => String(i.id)));

/** A drop from another column is a status change; within this one, a
 *  reorder, which only a manual view has (departure 7). */
function drop(taskId: string, after: string | null) {
  const item = props.all.find((i) => String(i.id) === taskId);
  if (!item) return;
  const across = item.column !== props.status.id;
  if (across || props.manual) {
    emit('move', item, across ? props.status.id : undefined, after);
  }
}

/** Keyboard path of a drop: one gap up is "after the card two above". */
const step = (index: number, to: 'up' | 'down') =>
  emit(
    'move',
    props.items[index]!,
    undefined,
    to === 'up' ? (ids.value[index - 2] ?? null) : ids.value[index + 1]!,
  );

const container = ref<HTMLElement | null>(null);
const drag = useDrag(container, drop);
</script>

<template>
  <section
    :aria-label="status.name"
    class="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-elevated/50 p-2"
  >
    <h3 class="flex items-center gap-1 px-1 text-sm font-semibold">
      <span data-testid="column-name">{{ status.name }}</span>
      <UIcon
        v-if="status.completing"
        name="i-lucide-circle-check"
        role="img"
        class="text-success"
        data-testid="completing"
        :aria-label="$t('kanban.completing')"
      />
      <span class="ml-auto text-muted">{{ items.length }}</span>
    </h3>
    <div
      ref="container"
      class="flex min-h-24 flex-col gap-2"
      data-testid="cards"
      v-bind="drag.containerEvents"
    >
      <KanbanCard
        v-for="(item, i) in items"
        :key="String(item.id)"
        :item="item"
        :columns="columns"
        :manual="manual"
        :first="i === 0"
        :last="i === items.length - 1"
        :data-task-id="String(item.id)"
        :class="
          drag.line.value === String(item.id) && 'border-t-2 !border-t-primary'
        "
        v-bind="drag.rowEvents(String(item.id))"
        @move-to="emit('move', item, $event)"
        @move="step(i, $event)"
        @open="emit('open', item)"
      />
      <div
        v-if="drag.line.value === END"
        class="h-0 border-t-2 border-primary"
      />
    </div>
  </section>
</template>
