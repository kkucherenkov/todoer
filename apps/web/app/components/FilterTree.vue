<script setup lang="ts">
import type { Filter } from '@todoer/client-core';
import { limitsOf, TREE } from '~/utils/filterTree';

const filter = defineModel<Filter>({ required: true });

provide(TREE, {
  root: computed(() => filter.value),
  edit: (fn) => {
    filter.value = fn(filter.value);
  },
});

const limits = computed(() => limitsOf(filter.value));
</script>

<template>
  <div class="flex flex-col gap-2">
    <FilterNode :node="filter" :path="[]" />
    <p class="text-xs text-muted" data-testid="filter-limits">
      {{ $t('filterTree.limits', limits) }}
    </p>
  </div>
</template>
