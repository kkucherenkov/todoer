<script setup lang="ts">
import type { Placement } from '@todoer/client-core';

const props = defineProps<{ placement: Placement | null }>();
const emit = defineEmits<{ move: [p: Placement, to: string]; close: [] }>();

const date = ref('');
watch(
  () => props.placement,
  (p) => p && (date.value = p.date),
);

// The same write as a drop: a drop's day is a cell's `data-date`, this one's
// is the input's value (a valid date or empty).
function submit() {
  if (props.placement && date.value) emit('move', props.placement, date.value);
  emit('close');
}
</script>

<template>
  <UModal
    :open="placement !== null"
    :title="$t('calendar.moveTo')"
    :description="$t('calendar.moveDescription')"
    :ui="{ description: 'sr-only' }"
    @update:open="(open) => !open && emit('close')"
  >
    <template #body>
      <form class="flex gap-2" @submit.prevent="submit">
        <UInput
          v-model="date"
          type="date"
          class="flex-1"
          :aria-label="$t('calendar.date')"
        />
        <UButton type="submit">{{ $t('calendar.move') }}</UButton>
      </form>
    </template>
  </UModal>
</template>
