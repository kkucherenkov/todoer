<script setup lang="ts">
import type { Item } from '@todoer/client-core';

const props = defineProps<{ view: string; sort: string; items: Item[] }>();
const db = useDb();
const route = useRoute();
const router = useRouter();
const fail = useFail();
const marked = useMarked();
const catalog = useTopic('catalog');

const statuses = computed(() => catalog.value?.statuses ?? []);
// Cards sit where displayStatus puts them (`column`), never by their own
// statusId: a recurring task done today is open again in the first column.
const columns = computed(() =>
  statuses.value.map((status) => ({
    status,
    items: props.items.filter((i) => i.column === status.id),
  })),
);
const editing = ref(false);

/** Into the completing column is done and gets the mark's toast, Undo
 *  included; out of it is undo (views Q5, by the core). */
async function move(item: Item, statusId?: string, after?: string | null) {
  const taskId = String(item.id);
  const result = await db.write({
    kind: 'move',
    taskId,
    view: props.view,
    ...(statusId !== undefined && { statusId }),
    ...(after !== undefined && { after }),
  });
  if (!result.ok) return fail(result);
  if (result.note?.marked === 'done') {
    marked(taskId, String(item.title), 'done', result.note);
  }
}

const open = (item: Item) =>
  router.push({ query: { ...route.query, task: String(item.id) } });
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="board">
    <div class="flex justify-end">
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-columns-3"
        :disabled="statuses.length === 0"
        @click="editing = true"
      >
        {{ $t('kanban.columns') }}
      </UButton>
    </div>
    <p v-if="statuses.length === 0" class="text-sm text-muted">
      {{ $t('kanban.noColumns') }}
    </p>
    <div v-else class="flex items-start gap-3 overflow-x-auto pb-2">
      <KanbanColumn
        v-for="c in columns"
        :key="c.status.id"
        :status="c.status"
        :columns="statuses"
        :items="c.items"
        :all="items"
        :manual="sort === 'manual'"
        @move="move"
        @open="open"
      />
    </div>
    <ColumnsDialog v-model:open="editing" />
  </div>
</template>
