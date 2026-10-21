<script setup lang="ts">
import type { Item } from '@todoer/client-core';

const props = defineProps<{ view: string; sort: string; items: Item[] }>();
const { locale } = useI18n();
const groups = computed(() => outline(props.items, locale.value));
</script>

<template>
  <div class="flex flex-col gap-4">
    <QuickAdd />
    <p v-if="items.length === 0" class="text-sm text-muted">
      {{ $t('list.empty') }}
    </p>
    <div v-else class="flex flex-col gap-4" data-testid="task-list">
      <TaskGroup
        v-for="g in groups"
        :key="g.projectId ?? ''"
        :group="g"
        :view="view"
        :manual="sort === 'manual'"
      />
    </div>
  </div>
</template>
