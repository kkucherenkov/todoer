<!-- Page header: references/ViewHeader.vue (one shared shell instance); layout is transient and preserves query/task. -->
<script setup lang="ts">
// Source-compatible Nuxt UI 4 reference. New navigation/capture UX lives in
// ux.html only; keep the repository's write and projection contracts here.
import { computed, ref } from "vue";
import type { Ref } from "vue";
import type { TaskDetails } from "@todoer/client-core";
import type { DropdownMenuItem } from "@nuxt/ui";

type BoardItem = {
  id: string;
  title: string;
  column: string | null;
  closed: boolean;
  project?: string | null;
  tags: string[];
  priority: number;
  occurrence?: string | null;
  dueOn?: string | null;
  parentId?: string | null;
  parentTitle?: string | null;
};
// Unfiltered parent detail topics: never derive total progress from filtered items.
const props = defineProps<{
  view: string;
  sort: string;
  items: BoardItem[];
  parentDetails?: Record<string, TaskDetails>;
}>();
const expandedParents = ref<string[]>([]);
const childrenOf = (id: string) => props.parentDetails?.[id]?.subtasks ?? [];
function toggleChildren(id: string) {
  expandedParents.value = expandedParents.value.includes(id)
    ? expandedParents.value.filter((key) => key !== id)
    : [...expandedParents.value, id];
}
async function tickChild(parentId: string, id: string, closed: boolean) {
  const parent = props.parentDetails?.[parentId];
  if (!parent) return;
  const result = await db.write({
    kind: "mark",
    taskId: id,
    mark: closed ? "done" : "undo",
    ...(parent.rrule && parent.occurrence ? { on: parent.occurrence } : {}),
  });
  if (!result.ok) fail(result);
}
const db = useDb();
const catalog = useTopic("catalog");
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const fail = useFail();
const marked = useMarked();
const openParent = useOpenTask();
const editing = ref(false);
const statuses = computed(() => catalog.value?.statuses ?? []);
// `column` is displayStatus, not the task's stored statusId. In particular,
// recurring completion advances to the next occurrence in the first column.
const columns = computed(() =>
  statuses.value.map((status) => ({
    status,
    items: props.items.filter((item) => item.column === status.id),
  })),
);
const manual = computed(() => props.sort === "manual");
const open = (item: BoardItem) =>
  router.push({ query: { ...route.query, task: String(item.id) } });
async function move(item: BoardItem, statusId?: string, after?: string | null) {
  const result = await db.write({
    kind: "move",
    taskId: String(item.id),
    view: props.view,
    ...(statusId !== undefined && { statusId }),
    ...(after !== undefined && { after }),
  });
  if (!result.ok) return fail(result);
  // Existing mark Undo, not a made-up reverse status assignment.
  if (result.note?.marked === "done")
    marked(String(item.id), item.title, "done", result.note);
}
const priorityColor = (p: number): "error" | "warning" | "info" | "neutral" =>
  p === 0 ? "error" : p === 1 ? "warning" : p === 2 ? "info" : "neutral";
function step(
  item: BoardItem,
  items: BoardItem[],
  index: number,
  to: "up" | "down",
) {
  return move(
    item,
    undefined,
    to === "up" ? (items[index - 2]?.id ?? null) : items[index + 1]!.id,
  );
}
function actions(
  item: BoardItem,
  items: BoardItem[],
  index: number,
): DropdownMenuItem[] {
  return [
    {
      label: t("kanban.moveTo"),
      icon: "i-lucide-columns-3",
      children: statuses.value.map((status) => ({
        label: status.name,
        disabled: status.id === item.column,
        onSelect: () => move(item, status.id),
      })),
    },
    ...(manual.value
      ? [
          {
            label: t("list.moveUp"),
            icon: "i-lucide-arrow-up",
            disabled: index === 0,
            onSelect: () => step(item, items, index, "up"),
          },
          {
            label: t("list.moveDown"),
            icon: "i-lucide-arrow-down",
            disabled: index === items.length - 1,
            onSelect: () => step(item, items, index, "down"),
          },
        ]
      : []),
    {
      label: t("list.open"),
      icon: "i-lucide-panel-right-open",
      onSelect: () => open(item),
    },
  ];
}
// One independent useDrag container per status. Cross-column drops always
// work; reordering in a column is allowed only for a manual view.
const drags = new Map<
  string,
  { container: Ref<HTMLElement | null>; drag: ReturnType<typeof useDrag> }
>();
function dragFor(statusId: string) {
  let entry = drags.get(statusId);
  if (!entry) {
    const container = ref<HTMLElement | null>(null);
    const drag = useDrag(container, (taskId, after) => {
      const item = props.items.find((row) => String(row.id) === taskId);
      if (!item) return;
      const across = item.column !== statusId;
      if (across || manual.value)
        void move(item, across ? statusId : undefined, after);
    });
    entry = { container, drag };
    drags.set(statusId, entry);
  }
  return entry;
}
</script>

<template>
  <!-- AppShell supplies the existing sidebar, sync/refusal/footer and drawer.
       UpdatePrompt retains the existing service-worker/stale-tab handling. -->
  <AppShell>
    <div class="flex min-w-0 flex-col gap-4" data-od-id="kanban-screen">
      <UpdatePrompt />
      <div class="flex justify-end">
        <UButton
          color="neutral"
          variant="outline"
          size="md"
          icon="i-lucide-columns-3"
          :disabled="statuses.length === 0"
          data-od-id="columns-trigger"
          @click="editing = true"
          >{{ $t("kanban.columns") }}</UButton
        >
      </div>
      <p
        v-if="statuses.length === 0"
        class="text-sm text-muted"
        data-od-id="board-before-sync"
      >
        {{ $t("kanban.noColumns") }}
      </p>
      <div
        v-else
        class="flex min-w-0 items-start gap-4 overflow-x-auto pb-4"
        data-testid="board"
        data-od-id="kanban-board"
      >
        <section
          v-for="column in columns"
          :key="column.status.id"
          :aria-label="column.status.name"
          class="flex w-72 shrink-0 flex-col gap-3 rounded-lg border border-default bg-elevated p-3"
          :data-od-id="`column-${column.status.id}`"
        >
          <h2
            class="flex items-center gap-2 text-sm font-semibold text-highlighted"
          >
            <span
              class="min-w-0 flex-1 break-words"
              data-testid="column-name"
              >{{ column.status.name }}</span
            >
            <UIcon
              v-if="column.status.completing"
              name="i-lucide-circle-check"
              role="img"
              class="size-4 text-success"
              data-testid="completing"
              :aria-label="$t('kanban.completing')"
            />
            <span class="text-xs font-normal text-toned tabular-nums">{{
              column.items.length
            }}</span>
          </h2>
          <div
            :ref="
              (element) => {
                dragFor(column.status.id).container.value =
                  element as HTMLElement | null;
              }
            "
            class="flex min-h-24 flex-col gap-3"
            data-testid="cards"
            v-bind="dragFor(column.status.id).drag.containerEvents"
          >
            <div
              v-for="(item, index) in column.items"
              :key="String(item.id)"
              tabindex="0"
              class="group flex items-start gap-2 rounded-md border border-default bg-default p-3 focus-visible:outline-2 focus-visible:outline-primary"
              :class="
                dragFor(column.status.id).drag.line.value === String(item.id) &&
                'border-t-2 !border-t-primary'
              "
              data-testid="card"
              :data-task-id="String(item.id)"
              :data-od-id="`card-${item.id}`"
              v-bind="dragFor(column.status.id).drag.rowEvents(String(item.id))"
              @keydown.enter.self="open(item)"
            >
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <button
                  type="button"
                  class="rounded-sm text-left text-sm font-medium text-highlighted break-words whitespace-normal focus-visible:outline-2 focus-visible:outline-primary"
                  :class="item.closed && 'text-muted line-through'"
                  :data-od-id="`card-title-${item.id}`"
                  @click="open(item)"
                >
                  {{ item.title }}
                </button>
                <UButton
                  v-if="item.parentTitle"
                  color="neutral"
                  variant="link"
                  size="xs"
                  icon="i-lucide-corner-down-right"
                  class="p-0 text-muted hover:text-highlighted whitespace-normal"
                  data-testid="parent-link"
                  :aria-label="
                    $t('list.openParent', { title: item.parentTitle })
                  "
                  @click.stop="openParent(String(item.parentId))"
                  >{{
                    $t("list.openParent", { title: item.parentTitle })
                  }}</UButton
                >
                <div v-if="!item.parentId && childrenOf(item.id).length">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="
                      expandedParents.includes(item.id)
                        ? 'i-lucide-chevron-down'
                        : 'i-lucide-chevron-right'
                    "
                    :aria-expanded="expandedParents.includes(item.id)"
                    :aria-controls="`children-${item.id}`"
                    :aria-label="`${$t('drawer.subtasksTitle')}: ${item.title}`"
                    @click.stop="toggleChildren(item.id)"
                  >
                    {{
                      $t("drawer.progress", {
                        done: childrenOf(item.id).filter(
                          (child) => child.closed,
                        ).length,
                        total: childrenOf(item.id).length,
                      })
                    }}
                    · {{ $t("drawer.subtasksTitle") }}
                  </UButton>
                  <!-- Contextual links, not additional ranked cards or count entries. -->
                  <div
                    v-if="expandedParents.includes(item.id)"
                    :id="`children-${item.id}`"
                    class="mt-1 flex flex-col gap-1 border-l border-default pl-2"
                  >
                    <div
                      v-for="child in childrenOf(item.id)"
                      :key="child.id"
                      class="flex items-center gap-2"
                    >
                      <UCheckbox
                        :model-value="child.closed"
                        :aria-label="
                          $t('drawer.doneLabel', { title: child.title })
                        "
                        @update:model-value="
                          tickChild(item.id, child.id, $event === true)
                        "
                      />
                      <UButton
                        variant="link"
                        color="neutral"
                        class="min-h-11 min-w-0 whitespace-normal break-words text-left"
                        :class="child.closed && 'line-through'"
                        @click.stop="openParent(child.id)"
                        >{{ child.title }}</UButton
                      >
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted">
                  <span v-if="item.project" class="break-words"
                    >#{{ item.project }}</span
                  >
                  <span
                    v-for="tag in item.tags"
                    :key="tag"
                    class="break-words"
                    >{{ tag }}</span
                  >
                  <UBadge
                    v-if="Number.isInteger(Number(item.priority))"
                    :color="priorityColor(Number(item.priority))"
                    variant="subtle"
                    size="sm"
                    >p{{ item.priority }}</UBadge
                  >
                  <span
                    v-if="item.occurrence"
                    class="inline-flex items-center gap-1 tabular-nums"
                    data-testid="occurrence"
                    ><UIcon name="i-lucide-repeat" class="size-4" />{{
                      item.occurrence
                    }}</span
                  >
                  <span v-if="item.dueOn" class="tabular-nums">{{
                    $t("list.due", { date: item.dueOn })
                  }}</span>
                </div>
              </div>
              <UDropdownMenu :items="actions(item, column.items, index)">
                <!-- Always present for touch; focus and hover never hide it. -->
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-ellipsis"
                  :aria-label="$t('list.actions')"
                  :data-od-id="`card-actions-${item.id}`"
                />
              </UDropdownMenu>
            </div>
            <div
              v-if="dragFor(column.status.id).drag.line.value === ''"
              class="h-0 border-t-2 border-primary"
              :data-od-id="`drop-end-${column.status.id}`"
            />
          </div>
        </section>
      </div>
      <!-- Existing ColumnsDialog preserves saveStatus/setCompleting/
           deleteStatus, global live-task redistribution counts, name restore
           on refusal and its duplicate/completing/last-open constraints. -->
      <ColumnsDialog v-model:open="editing" />
    </div>
  </AppShell>
</template>
