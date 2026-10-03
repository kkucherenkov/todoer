<script setup lang="ts">
const route = useRoute();
const db = useDb();
const fail = useFail();
const catalog = useTopic('catalog');
const view = computed(() =>
  catalog.value?.views.find((v) => v.id === route.params.id),
);
// The worker's date, kept apart from the view topic: a watch with a new span
// clears that topic, and a span derived from it would never settle.
const shown = useTopic('view');
const today = ref<string>();
watch(shown, (v) => v && (today.value = v.today));
// The span comes from the URL alone, and only a calendar has one: a stale
// span on a list publish would be dropped by the tab and hang it (F3).
useWatch(
  () => String(route.params.id),
  () => {
    if (view.value?.layout !== 'calendar') return null;
    const { mode, at } = fromQuery(route.query, today.value ?? '');
    if (!at) return null;
    return gridSpan(mode, at);
  },
);
const editing = ref(false);
const deleting = ref(false);

async function remove() {
  if (!view.value) return;
  const result = await db.write({ kind: 'deleteView', id: view.value.id });
  if (!result.ok) return fail(result);
  deleting.value = false;
  await navigateTo('/');
}
</script>

<template>
  <div class="contents">
    <!-- One root, as Nuxt pages need; `contents` keeps both children in the
         panel's flex column, laid out as before. -->
    <div v-if="view" class="mb-3 flex justify-end gap-2">
      <UButton
        variant="ghost"
        color="neutral"
        icon="i-lucide-pencil"
        data-testid="edit-view"
        @click="editing = true"
      >
        {{ $t('viewForm.edit') }}
      </UButton>
      <UButton
        variant="ghost"
        color="error"
        icon="i-lucide-trash-2"
        data-testid="delete-view"
        @click="deleting = true"
      >
        {{ $t('viewForm.delete') }}
      </UButton>
      <ViewForm v-model:open="editing" :view="view" />
      <UModal
        v-model:open="deleting"
        :title="$t('viewForm.deleteTitle', { name: view.name })"
        :description="$t('viewForm.deleteBody')"
      >
        <template #footer>
          <UButton variant="ghost" color="neutral" @click="deleting = false">
            {{ $t('viewForm.cancel') }}
          </UButton>
          <UButton color="error" data-testid="confirm-delete" @click="remove">
            {{ $t('viewForm.delete') }}
          </UButton>
        </template>
      </UModal>
    </div>
    <ViewBody />
  </div>
</template>
