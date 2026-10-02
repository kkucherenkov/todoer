<script setup lang="ts">
const props = defineProps<{ open: boolean; title: string; subtasks: number }>();
const emit = defineEmits<{ confirm: []; close: [] }>();

const { locale, t } = useI18n();
const cancelButton = ref<{ $el: HTMLElement } | null>(null);

const text = computed(() =>
  props.subtasks === 0
    ? t('deleteTask.confirm', { title: props.title })
    : t('deleteTask.confirmWith', {
        title: props.title,
        subtasks: t(
          `drawer.subtasks.${pluralForm(locale.value, props.subtasks)}`,
          {
            n: props.subtasks,
          },
        ),
      }),
);
</script>

<template>
  <UModal
    :open="open"
    :title="$t('deleteTask.title')"
    :description="text"
    :ui="{ description: 'sr-only' }"
    :content="{
      // Cancel has the focus, so Enter cannot delete (an alertdialog's
      // least destructive action).
      onOpenAutoFocus: (e: Event) => {
        e.preventDefault();
        cancelButton?.$el.focus();
      },
    }"
    @update:open="(o) => !o && emit('close')"
  >
    <template #body>
      <p>{{ text }}</p>
      <p class="mt-1 text-sm text-muted">{{ $t('deleteTask.irreversible') }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <UButton
          ref="cancelButton"
          variant="outline"
          color="neutral"
          @click="emit('close')"
        >
          {{ $t('deleteTask.cancel') }}
        </UButton>
        <UButton
          color="error"
          data-testid="confirm-delete"
          @click="emit('confirm')"
        >
          {{ $t('deleteTask.delete') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
