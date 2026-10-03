<!-- Extracted route contract: apps/web/app/pages/views/[id].vue. Not installed. -->
<script setup lang="ts">
import type { Catalog } from '@todoer/client-core';
const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{ view: Catalog['views'][number] }>();
const emit = defineEmits<{ deleted: [] }>();
const db = useDb();
const fail = useFail();
const pending = ref(false);
async function remove() {
  if (pending.value) return;
  pending.value = true;
  try {
    const result = await db.write({ kind: 'deleteView', id: props.view.id });
    if (!result.ok) return fail(result);
    open.value = false;
    emit('deleted');
    await navigateTo('/');
  } finally { pending.value = false; }
}
</script>
<template>
  <UModal v-model:open="open"
    :title="$t('viewForm.deleteTitle', { name: view.name })"
    :description="$t('viewForm.deleteBody')" data-od-id="delete-view-reference">
    <template #footer>
      <UButton color="neutral" variant="ghost" @click="open = false">{{ $t('viewForm.cancel') }}</UButton>
      <UButton color="error" :loading="pending" :disabled="pending" data-testid="confirm-delete" @click="remove">{{ $t('viewForm.delete') }}</UButton>
    </template>
  </UModal>
</template>
