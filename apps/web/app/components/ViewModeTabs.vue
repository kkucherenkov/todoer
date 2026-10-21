<script setup lang="ts">
import type { Layout, LayoutKey } from '~/utils/layout';

const props = defineProps<{ layout: Layout; saved: Layout }>();
const emit = defineEmits<{ change: [layout: Layout] }>();
const { t } = useI18n();
const group = ref<HTMLElement | null>(null);
const pendingFocus = ref<Layout | null>(null);

const modes = computed(() =>
  LAYOUTS.map((value) => ({
    value,
    label: t(`layouts.${value}`),
    icon:
      value === 'list'
        ? 'i-lucide-list'
        : value === 'kanban'
          ? 'i-lucide-kanban'
          : 'i-lucide-calendar',
    available: layoutAvailable(value, props.saved),
  })),
);

function focusMode(value: Layout) {
  group.value
    ?.querySelector<HTMLButtonElement>(`[data-layout="${value}"]`)
    ?.focus({ preventScroll: true });
}

async function choose(value: Layout) {
  if (!layoutAvailable(value, props.saved)) return;
  pendingFocus.value = value;
  emit('change', value);
  if (value !== props.layout) return;
  await nextTick();
  focusMode(value);
  pendingFocus.value = null;
}

watch(
  () => props.layout,
  async (value) => {
    if (pendingFocus.value !== value) return;
    await nextTick();
    focusMode(value);
    pendingFocus.value = null;
  },
);

function navigate(event: KeyboardEvent, value: Layout) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  void choose(nextLayout(value, event.key as LayoutKey, props.saved));
}
</script>

<template>
  <div
    ref="group"
    role="tablist"
    class="mode-tabs"
    :aria-label="$t('layouts.group')"
    data-testid="layout-tabs"
  >
    <button
      v-for="mode in modes"
      :id="`mode-${mode.value}`"
      :key="mode.value"
      type="button"
      role="tab"
      class="mode-tab"
      :data-layout="mode.value"
      :aria-selected="layout === mode.value"
      :aria-disabled="!mode.available || undefined"
      :aria-label="mode.label"
      :title="
        mode.available
          ? mode.label
          : $t('layouts.unavailable', { layout: mode.label })
      "
      :tabindex="layout === mode.value ? 0 : -1"
      aria-controls="view-content"
      @click="choose(mode.value)"
      @keydown="navigate($event, mode.value)"
    >
      <UIcon :name="mode.icon" aria-hidden="true" />
    </button>
  </div>
</template>
