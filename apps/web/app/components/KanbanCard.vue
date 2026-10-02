<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Catalog, Item } from '@todoer/client-core';

const props = defineProps<{
  item: Item;
  columns: Catalog['statuses'];
  /** Move up and down exist only under the manual sort. */
  manual: boolean;
  first: boolean;
  last: boolean;
}>();
const emit = defineEmits<{
  moveTo: [statusId: string];
  move: [to: 'up' | 'down'];
  open: [];
}>();
const { t } = useI18n();
const open = useOpenTask();

// Every drop has a keyboard and touch path: native DnD needs a pointer.
const actions = computed<DropdownMenuItem[]>(() => [
  {
    label: t('kanban.moveTo'),
    icon: 'i-lucide-columns-3',
    children: props.columns.map((c) => ({
      label: c.name,
      disabled: c.id === props.item.column,
      onSelect: () => emit('moveTo', c.id),
    })),
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
  {
    label: t('list.open'),
    icon: 'i-lucide-panel-right-open',
    onSelect: () => emit('open'),
  },
]);
</script>

<template>
  <div
    tabindex="0"
    class="flex items-start gap-2 rounded-md border border-default bg-default p-2 focus-visible:outline-2 focus-visible:outline-primary"
    data-testid="card"
    @keydown.enter.self="emit('open')"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <span
        class="cursor-pointer font-medium break-words"
        :class="item.closed && 'text-muted line-through'"
        @click="emit('open')"
      >
        {{ item.title }}
      </span>
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
      <div class="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted">
        <span v-if="item.project">#{{ item.project }}</span>
        <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
        <UBadge
          v-if="Number(item.priority) > 0"
          color="neutral"
          variant="subtle"
          size="sm"
        >
          p{{ item.priority }}
        </UBadge>
        <span v-if="item.occurrence" data-testid="occurrence">
          {{ item.occurrence }}
        </span>
        <span v-if="item.dueOn">
          {{ $t('list.due', { date: item.dueOn }) }}
        </span>
      </div>
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
