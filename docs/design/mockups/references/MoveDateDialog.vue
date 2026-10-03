<!-- Read-only source contract reference; not installed in the application. -->
<script setup lang="ts">
import type { Placement } from '@todoer/client-core';

const props = defineProps<{ placement: Placement | null; apply: (p: Placement, to: string) => Promise<boolean> }>();
const emit = defineEmits<{ move: [p: Placement, to: string]; close: [] }>();

const date = ref('');
const saving = ref(false);
watch(
  () => props.placement,
  (p) => p && (date.value = p.date),
);

// The same write as a drop: a drop's day is a cell's `data-date`, this one's
// is the input's value (a valid date or empty).
async function submit() {
  if (!props.placement || !date.value || saving.value) return;
  saving.value = true;
  try { if (await props.apply(props.placement, date.value)) emit('close'); }
  finally { saving.value = false; }
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
          required
          class="flex-1"
          :aria-label="$t('calendar.date')"
        />
        <UButton type="submit" :loading="saving" :disabled="saving || !date">{{ $t('calendar.move') }}</UButton>
      </form>
    </template>
  </UModal>
</template>
