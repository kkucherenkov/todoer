<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Item } from '@todoer/client-core';

const props = defineProps<{
  item: Item;
  /** Move up and down exist only under the manual sort. */
  manual: boolean;
  first: boolean;
  last: boolean;
  /** The parent's children are hidden; `hidden` of them are listed. */
  folded?: boolean;
  hidden?: number;
  /** The row Indent puts this one under; null: none above. Indent shows
   *  only for a task the core would let become a subtask. */
  indentUnder?: { id: string; title: string } | null;
}>();
const emit = defineEmits<{
  mark: [mark: 'done' | 'skip'];
  move: [to: 'up' | 'down'];
  open: [opener?: HTMLElement];
  fold: [];
  reparent: [parentId: string | null];
}>();
const { t } = useI18n();
const open = useOpenTask();
const row = ref<HTMLElement | null>(null);

const actions = computed<DropdownMenuItem[]>(() => [
  {
    label: t('list.skip'),
    icon: 'i-lucide-skip-forward',
    onSelect: () => emit('mark', 'skip'),
  },
  ...(props.manual
    ? [
        {
          label: t('list.moveUp'),
          icon: 'i-lucide-arrow-up',
          disabled: props.first,
          onSelect: () => emit('move', 'up'),
        },
        {
          label: t('list.moveDown'),
          icon: 'i-lucide-arrow-down',
          disabled: props.last,
          onSelect: () => emit('move', 'down'),
        },
      ]
    : []),
  ...(canIndent(props.item)
    ? [
        {
          label: props.indentUnder
            ? t('list.indent', { title: props.indentUnder.title })
            : t('list.indentNone'),
          icon: 'i-lucide-indent-increase',
          disabled: !props.indentUnder,
          onSelect: () => emit('reparent', props.indentUnder!.id),
        },
      ]
    : []),
  ...(typeof props.item.parentId === 'string'
    ? [
        {
          label: t('list.outdent'),
          icon: 'i-lucide-indent-decrease',
          onSelect: () => emit('reparent', null),
        },
      ]
    : []),
  {
    label: t('list.open'),
    icon: 'i-lucide-panel-right-open',
    onSelect: () => emit('open', row.value ?? undefined),
  },
]);
</script>

<template>
  <div
    ref="row"
    tabindex="-1"
    class="flex items-center gap-3 px-2 py-2"
    data-testid="task-row"
  >
    <UButton
      variant="outline"
      color="neutral"
      icon="i-lucide-check"
      class="rounded-full"
      size="sm"
      :aria-label="$t('list.markDone')"
      @click="emit('mark', 'done')"
    />
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        class="truncate text-left font-medium"
        data-task-opener
        data-testid="task-title"
        @click="emit('open', $event.currentTarget as HTMLElement)"
      >
        {{ item.title }}
      </button>
      <UButton
        v-if="item.parentTitle"
        variant="link"
        color="neutral"
        size="xs"
        icon="i-lucide-corner-down-right"
        class="p-0"
        data-testid="parent-link"
        :aria-label="$t('list.openParent', { title: item.parentTitle })"
        @click.stop="open(String(item.parentId))"
      >
        {{ item.parentTitle }}
      </UButton>
      <span v-if="item.project" class="text-sm text-muted"
        >#{{ item.project }}</span
      >
      <span v-for="tag in item.tags" :key="tag" class="text-sm text-muted">{{
        tag
      }}</span>
      <UBadge
        v-if="Number(item.priority) < 4"
        color="neutral"
        variant="subtle"
        size="sm"
      >
        p{{ item.priority }}
      </UBadge>
      <span
        v-if="item.occurrence"
        class="text-sm text-muted"
        data-testid="occurrence"
      >
        {{ item.occurrence }}
      </span>
      <span v-if="item.dueOn" class="text-sm text-muted">
        {{ $t('list.due', { date: item.dueOn }) }}
      </span>
      <UBadge v-if="item.status" color="primary" variant="soft" size="sm">
        {{ item.status }}
      </UBadge>
      <UButton
        v-if="item.subtasks"
        variant="ghost"
        color="neutral"
        size="xs"
        class="tabular-nums"
        :icon="folded ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
        :aria-expanded="!folded"
        :aria-controls="`children-${item.id}`"
        :aria-label="
          $t('list.subtasksOf', { title: item.title, ...item.subtasks })
        "
        @click="emit('fold')"
      >
        {{ item.subtasks.done }}/{{ item.subtasks.total }}
        <span v-if="folded && hidden" class="text-muted">
          · {{ $t('list.hidden', { n: hidden }) }}
        </span>
      </UButton>
    </div>
    <UDropdownMenu :items="actions">
      <UButton
        variant="ghost"
        color="neutral"
        icon="i-lucide-ellipsis"
        size="sm"
        :aria-label="$t('list.actions')"
      />
    </UDropdownMenu>
  </div>
</template>
