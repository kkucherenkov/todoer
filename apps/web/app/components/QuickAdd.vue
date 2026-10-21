<script setup lang="ts">
import { createQuickAddSubmitter, type QuickAddDraft } from '~/utils/quickAdd';

const db = useDb();
const { t } = useI18n();
const view = useTopic('view');
const catalog = useTopic('catalog');
const toast = useToast();
const expanded = ref(false);
const saving = ref(false);
const draft = reactive<QuickAddDraft>({
  text: '',
  project: '',
  tags: '',
  priority: null,
  scheduledOn: '',
  dueOn: '',
});
const error = ref<string | null>(null);
watch(draft, () => (error.value = null), { deep: true });
const submit = createQuickAddSubmitter(db);

const projects = computed(() => [
  { label: t('list.quickAddUseSyntax'), value: '' },
  ...(catalog.value?.projects ?? []).map((project) => ({
    label: project.name,
    value: project.name,
  })),
]);
const priorities = computed(() => [
  { label: t('list.quickAddUseSyntax'), value: null },
  ...[0, 1, 2, 3, 4].map((priority) => ({
    label: t('list.quickAddPriority', { priority }),
    value: priority,
  })),
]);

const clear = () => {
  draft.text = '';
  draft.project = '';
  draft.tags = '';
  draft.priority = null;
  draft.scheduledOn = '';
  draft.dueOn = '';
};

async function add() {
  if (draft.text.trim() === '' || saving.value) return;
  saving.value = true;
  const { result, taskId } = await submit({ ...draft });
  saving.value = false;
  if (result.ok) {
    error.value = null;
    clear();
    await nextTick();
    if (
      view.value &&
      !view.value.items.some((item) => String(item.id) === taskId)
    ) {
      toast.add({
        title: t('list.quickAddOutsideTitle'),
        description: t('list.quickAddOutsideDescription'),
        actions: [
          {
            label: t('list.quickAddOpenAll'),
            onClick: () => {
              void navigateTo({ path: '/', query: { task: taskId } });
            },
          },
        ],
      });
    }
    return;
  }
  const { kind, detail } = result.failure;
  error.value =
    kind === 'invalid'
      ? `${t('errors.invalid')} ${detail}`
      : `${t(`errors.${kind}`)} ${detail}`;
}
</script>

<template>
  <form class="flex flex-col gap-2" @submit.prevent="add">
    <div class="flex flex-col gap-2 sm:flex-row">
      <UInput
        v-model="draft.text"
        class="min-w-0 flex-1"
        :placeholder="$t('list.quickAddPlaceholder')"
        :aria-label="$t('list.quickAdd')"
        icon="i-lucide-plus"
        size="lg"
        autocomplete="off"
      />
      <UButton type="submit" size="lg" :loading="saving">
        {{ $t('list.quickAddSubmit') }}
      </UButton>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <UButton
        type="button"
        variant="link"
        color="neutral"
        class="p-0"
        :aria-expanded="expanded"
        aria-controls="quick-add-details"
        @click="expanded = !expanded"
      >
        {{ expanded ? $t('list.quickAddLess') : $t('list.quickAddDetails') }}
      </UButton>
      <span class="text-xs text-muted">{{ $t('list.quickAddHint') }}</span>
    </div>
    <div
      v-if="expanded"
      id="quick-add-details"
      class="grid gap-3 rounded-lg border border-default bg-muted p-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <UFormField :label="$t('drawer.project')">
        <USelect
          v-model="draft.project"
          class="w-full"
          :items="projects"
          value-key="value"
        />
      </UFormField>
      <UFormField :label="$t('drawer.tags')">
        <UInput
          v-model="draft.tags"
          class="w-full"
          :placeholder="$t('list.quickAddTagsPlaceholder')"
        />
      </UFormField>
      <UFormField :label="$t('drawer.priority')">
        <USelect
          v-model="draft.priority"
          class="w-full"
          :items="priorities"
          value-key="value"
        />
      </UFormField>
      <UFormField :label="$t('drawer.scheduled')">
        <UInput v-model="draft.scheduledOn" class="w-full" type="date" />
      </UFormField>
      <UFormField :label="$t('drawer.due')">
        <UInput v-model="draft.dueOn" class="w-full" type="date" />
      </UFormField>
    </div>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </form>
</template>
