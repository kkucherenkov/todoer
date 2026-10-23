<script setup lang="ts">
import type { Catalog } from '@todoer/client-core';

const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{ view: Catalog['views'][number] }>();
const db = useDb();
const fail = useFail();
// One delete in flight: a second click would send a second deleteView.
const pending = ref(false);

async function remove() {
  if (pending.value) return;
  pending.value = true;
  try {
    const result = await db.write({ kind: 'deleteView', id: props.view.id });
    if (!result.ok) return fail(result);
    open.value = false;
    // Here, not in the route: the deleted view leaves the catalog, and the
    // route unmounts this dialog, often before the write answers.
    await navigateTo('/');
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('viewForm.deleteTitle', { name: view.name })"
    :description="$t('viewForm.deleteBody')"
  >
    <template #footer>
      <UButton variant="ghost" color="neutral" @click="open = false">
        {{ $t('viewForm.cancel') }}
      </UButton>
      <UButton
        color="error"
        :loading="pending"
        :disabled="pending || !db.connected.value"
        data-testid="confirm-delete"
        @click="remove"
      >
        {{ $t('viewForm.delete') }}
      </UButton>
    </template>
  </UModal>
</template>
