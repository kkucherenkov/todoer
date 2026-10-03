<script setup lang="ts">
import type { Item } from '@todoer/client-core';

const props = defineProps<{ view: string; sort: string; items: Item[] }>();
const db = useDb();
const route = useRoute();
const router = useRouter();

const manual = computed(() => props.sort === 'manual');
const ids = computed(() => props.items.map((i) => String(i.id)));

const fail = useFail();
const marked = useMarked();

async function mark(item: Item, mark: 'done' | 'skip') {
  const taskId = String(item.id);
  const result = await db.write({ kind: 'mark', taskId, mark });
  if (!result.ok) return fail(result);
  marked(taskId, String(item.title), mark, result.note);
}

async function move(taskId: string, after: string | null) {
  const result = await db.write({
    kind: 'move',
    taskId,
    view: props.view,
    after,
  });
  if (!result.ok) fail(result);
}

/** Keyboard path of a drop: one gap up is "after the row two above". */
const step = (index: number, to: 'up' | 'down') =>
  move(
    ids.value[index]!,
    to === 'up' ? (ids.value[index - 2] ?? null) : ids.value[index + 1]!,
  );

const open = (item: Item) =>
  router.push({ query: { ...route.query, task: String(item.id) } });

const container = ref<HTMLElement | null>(null);
const drag = useDrag(
  container,
  (taskId, after) => void move(taskId, after),
  () => manual.value,
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <QuickAdd />
    <p v-if="items.length === 0" class="text-sm text-muted">
      {{ $t('list.empty') }}
    </p>
    <div
      v-else
      ref="container"
      class="divide-y divide-default"
      data-testid="task-list"
      v-bind="drag.containerEvents"
    >
      <TaskRow
        v-for="(item, i) in items"
        :key="String(item.id)"
        :item="item"
        :manual="manual"
        :first="i === 0"
        :last="i === items.length - 1"
        :data-task-id="String(item.id)"
        :class="
          drag.line.value === String(item.id) && 'border-t-2 !border-t-primary'
        "
        v-bind="drag.rowEvents(String(item.id))"
        @mark="mark(item, $event)"
        @move="step(i, $event)"
        @open="open(item)"
      />
      <div
        v-if="drag.line.value === END"
        class="h-0 border-t-2 border-primary"
      />
    </div>
  </div>
</template>
