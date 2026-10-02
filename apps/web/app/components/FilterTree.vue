<script setup lang="ts">
import { filterSize, type Filter } from '@todoer/client-core';
import { TREE } from '~/utils/filterTree';

const filter = defineModel<Filter>({ required: true });

provide(TREE, {
  root: computed(() => filter.value),
  edit: (fn) => {
    filter.value = fn(filter.value);
  },
});

const size = computed(() => filterSize(filter.value));
</script>

<template>
  <div class="flex flex-col gap-2">
    <FilterNode :node="filter" :path="[]" />
    <p class="text-xs text-muted" data-testid="filter-limits">
      {{ $t('filterTree.limits', size) }}
    </p>
  </div>
</template>
