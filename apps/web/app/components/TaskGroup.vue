<script setup lang="ts">
import type { Item } from '@todoer/client-core';
import type { Group } from '~/utils/outline';

// One project's part of the list outline. Its own drag container: a row
// moves among its siblings here, never into another group or parent.
const props = defineProps<{ group: Group; view: string; manual: boolean }>();
const db = useDb();
const openTask = useOpenTask();
const fail = useFail();
const marked = useMarked();
const folded = useFolded();
const { t, locale } = useI18n();

const heading = useId();
const name = computed(() => props.group.project ?? t('drawer.noProject'));
const count = computed(() =>
  t(`summary.tasks.${pluralForm(locale.value, props.group.count)}`, {
    n: props.group.count,
  }),
);

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

/** Keyboard path of a drop: one gap up is "after the sibling two above". */
function step(item: Item, to: 'up' | 'down') {
  const peers = siblings(props.group, String(item.id));
  const i = peers.indexOf(String(item.id));
  void move(
    String(item.id),
    to === 'up' ? (peers[i - 2] ?? null) : peers[i + 1]!,
  );
}

async function reparent(item: Item, parentId: string | null) {
  const result = await db.write({
    kind: 'reparent',
    taskId: String(item.id),
    parentId,
  });
  if (!result.ok) fail(result);
}

const container = ref<HTMLElement | null>(null);
const drag = useDrag(
  container,
  (taskId, after) => {
    const anchor = dropAfter(props.group, taskId, after);
    if (anchor !== undefined) void move(taskId, anchor);
  },
  () => props.manual && db.connected.value,
  (taskId, after) => dropAfter(props.group, taskId, after) !== undefined,
);
const line = (id: unknown) =>
  drag.line.value === String(id)
    ? { class: 'border-t-2 !border-t-primary' }
    : {};
const edge = (item: Item) =>
  props.group.edges.get(String(item.id)) ?? { first: true, last: true };
</script>

<template>
  <section :aria-labelledby="heading" class="flex flex-col gap-1">
    <header class="flex items-baseline justify-between gap-2 px-2">
      <h2 :id="heading" class="text-sm font-semibold text-highlighted">
        {{ name }}
      </h2>
      <span class="text-xs text-muted tabular-nums" data-testid="group-count">
        {{ count }}
      </span>
    </header>
    <div
      ref="container"
      class="divide-y divide-default"
      v-bind="drag.containerEvents"
    >
      <div v-for="(b, i) in group.branches" :key="String(b.item.id)">
        <TaskRow
          :item="b.item"
          :manual="manual"
          :folded="folded.isFolded(String(b.item.id))"
          :hidden-count="b.nested.length"
          :indent-under="indentUnder(group, i)"
          :data-task-id="String(b.item.id)"
          :nested="false"
          v-bind="{
            ...edge(b.item),
            ...line(b.item.id),
            ...drag.rowEvents(String(b.item.id)),
          }"
          @mark="mark(b.item, $event)"
          @move="step(b.item, $event)"
          @open="openTask(String(b.item.id), $event)"
          @fold="folded.toggle(String(b.item.id))"
          @reparent="reparent(b.item, $event)"
        />
        <div
          v-if="b.item.subtasks"
          v-show="!folded.isFolded(String(b.item.id))"
          :id="`children-${b.item.id}`"
          class="flex flex-col pl-8"
        >
          <TaskRow
            v-for="n in b.nested"
            :key="String(n.id)"
            :item="n"
            :manual="manual"
            :data-task-id="String(n.id)"
            nested
            v-bind="{
              ...edge(n),
              ...line(n.id),
              ...drag.rowEvents(String(n.id)),
            }"
            @mark="mark(n, $event)"
            @move="step(n, $event)"
            @open="openTask(String(n.id), $event)"
            @reparent="reparent(n, $event)"
          />
          <ChildLinks
            v-if="b.context.length > 0"
            :parent="b.item"
            :items="b.context"
            class="px-2 py-2"
          />
        </div>
      </div>
      <div
        v-if="drag.line.value === END"
        class="h-0 border-t-2 border-primary"
      />
    </div>
  </section>
</template>
