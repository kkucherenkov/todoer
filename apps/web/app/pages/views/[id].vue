<script setup lang="ts">
const route = useRoute();
const catalog = useTopic('catalog');
const view = computed(() =>
  catalog.value?.views.find((v) => v.id === route.params.id),
);
useWatch(() => String(route.params.id));
const editing = ref(false);
const deleting = ref(false);
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
      <DeleteViewDialog v-model:open="deleting" :view="view" />
    </div>
    <ViewBody />
  </div>
</template>
