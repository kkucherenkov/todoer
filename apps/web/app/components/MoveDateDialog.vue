<script setup lang="ts">
import type { Placement } from '@todoer/client-core';
import { exclusive } from '~/utils/exclusive';

const props = defineProps<{
  placement: Placement | null;
  /** The same write as a drop; true once the core accepted it. */
  apply: (p: Placement, to: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ close: [] }>();

const db = useDb();
const date = ref('');
watch(
  () => props.placement,
  (p) => p && (date.value = p.date),
);

// A refusal (its toast names the reason) keeps the dialog and the date, so
// Move again is the same intent; a second submit while one runs is dropped.
const { busy: saving, run: submit } = exclusive(async () => {
  if (!props.placement || !date.value) return;
  if (await props.apply(props.placement, date.value)) emit('close');
});
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
        <UButton
          type="submit"
          :loading="saving"
          :disabled="saving || !date || !db.connected.value"
        >
          {{ $t('calendar.move') }}
        </UButton>
      </form>
    </template>
  </UModal>
</template>
