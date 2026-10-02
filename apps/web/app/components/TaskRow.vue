<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Item } from '@todoer/client-core';

const props = defineProps<{
  item: Item;
  /** Move up and down exist only under the manual sort. */
  manual: boolean;
  first: boolean;
  last: boolean;
}>();
const emit = defineEmits<{
  mark: [mark: 'done' | 'skip'];
  move: [to: 'up' | 'down'];
  open: [];
}>();
const { t } = useI18n();
const open = useOpenTask();

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
  {
    label: t('list.open'),
    icon: 'i-lucide-panel-right-open',
    onSelect: () => emit('open'),
  },
]);
</script>

<template>
  <div class="flex items-center gap-3 px-2 py-2" data-testid="task-row">
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
        data-testid="task-title"
        @click="emit('open')"
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
        v-if="Number(item.priority) > 0"
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
