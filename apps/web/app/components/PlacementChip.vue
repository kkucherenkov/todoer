<script setup lang="ts">
import type { Item, Placement } from '@todoer/client-core';

defineProps<{ placement: Placement; item: Item }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button
    type="button"
    class="flex w-full min-w-0 items-center gap-1 rounded-md border border-default bg-default px-1.5 py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-primary"
    :class="placement.closed && 'text-muted'"
    data-testid="placement"
    :data-kind="placement.kind"
    :data-task-id="String(item.id)"
    @click="emit('open')"
  >
    <UIcon
      v-if="placement.closed"
      name="i-lucide-check"
      class="size-3.5 shrink-0"
    />
    <UIcon
      v-else-if="placement.kind === 'due'"
      name="i-lucide-flag"
      class="size-3.5 shrink-0"
    />
    <UIcon v-else name="i-lucide-calendar" class="size-3.5 shrink-0" />
    <span
      class="min-w-0 flex-1 truncate font-medium"
      :class="placement.closed && 'line-through'"
      data-testid="placement-title"
    >
      {{ item.title }}
    </span>
    <UIcon
      v-if="placement.occurrence !== null"
      name="i-lucide-repeat"
      class="size-3.5 shrink-0 text-muted"
    />
    <UBadge
      v-if="Number(item.priority) > 0"
      color="neutral"
      variant="subtle"
      size="sm"
    >
      p{{ item.priority }}
    </UBadge>
  </button>
</template>
