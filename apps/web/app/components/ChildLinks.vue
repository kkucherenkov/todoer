<script setup lang="ts">
import type { ChildItem, Item } from '@todoer/client-core';

// A parent's children as links with a check: on a list row the ones the
// view does not list, on a board card all of them. Nothing here counts.
const props = defineProps<{
  parent: Item;
  items: ChildItem[];
  /** A board: a listed child is a card of its own. */
  board?: boolean;
}>();
const tick = useTick();
const open = useOpenTask();
const catalog = useTopic('catalog');
const project = (id: string | null) =>
  catalog.value?.projects.find((p) => p.id === id)?.name;

const state = (c: ChildItem) =>
  props.board && c.inView
    ? 'kanban.onBoard'
    : c.closed
      ? 'list.childClosed'
      : 'list.outside';
</script>

<template>
  <ul class="flex flex-col gap-1">
    <li
      v-for="c in items"
      :key="c.id"
      class="flex items-start gap-2"
      data-testid="child-link"
    >
      <UCheckbox
        class="pt-0.5"
        :model-value="c.closed"
        :aria-label="$t('drawer.doneLabel', { title: c.title })"
        @update:model-value="tick(parent, c.id, $event === true)"
      />
      <div class="flex min-w-0 flex-col">
        <button
          type="button"
          class="text-left text-sm break-words"
          :class="c.closed && 'text-muted line-through'"
          data-task-opener
          @click="open(c.id, $event.currentTarget as HTMLElement)"
        >
          {{ c.title }}
        </button>
        <span class="text-xs text-muted">
          {{ $t(state(c)) }}
          <template v-if="project(c.projectId)">
            · #{{ project(c.projectId) }}
          </template>
        </span>
      </div>
    </li>
  </ul>
</template>
