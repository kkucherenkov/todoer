<!-- Shared page-header reference; emits presentation changes only. No saveView write. -->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
type Layout = 'list' | 'kanban' | 'calendar';
const layout = defineModel<Layout>('layout', { required: true });
const { locale } = useI18n();
const group = ref<HTMLElement | null>(null);
const modes = computed(() => [
  { value: 'list' as const, label: locale.value === 'ru' ? 'Список' : 'List', icon: 'i-lucide-list' },
  { value: 'kanban' as const, label: locale.value === 'ru' ? 'Доска' : 'Kanban', icon: 'i-lucide-kanban' },
  { value: 'calendar' as const, label: locale.value === 'ru' ? 'Календарь' : 'Calendar', icon: 'i-lucide-calendar' },
]);
async function choose(value: Layout) {
  layout.value = value;
  await nextTick();
  group.value?.querySelector<HTMLButtonElement>(`[data-layout="${value}"]`)?.focus({ preventScroll: true });
}
function navigate(event: KeyboardEvent, value: Layout) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = modes.value.findIndex(mode => mode.value === value);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
  void choose(modes.value[next]!.value);
}
</script>
<template>
  <div ref="group" role="tablist" class="mode-tabs" data-od-id="page-view-modes"
    :aria-label="locale === 'ru' ? 'Режим отображения' : 'Layout'">
    <button v-for="mode in modes" :key="mode.value" type="button" role="tab"
      :id="`mode-${mode.value}`" :data-layout="mode.value" :data-od-id="`mode-${mode.value}`"
      :aria-selected="layout === mode.value" :tabindex="layout === mode.value ? 0 : -1"
      :aria-label="mode.label" :title="mode.label" aria-controls="view-content"
      @click="choose(mode.value)" @keydown="navigate($event, mode.value)">
      <UIcon :name="mode.icon" aria-hidden="true" />
    </button>
  </div>
</template>
<style scoped>
.mode-tabs{display:flex;flex:none;gap:2px}
button{position:relative;width:44px;height:44px;padding:9px;border:1px solid transparent;border-radius:var(--radius-md);background:transparent;color:var(--ui-text);display:inline-flex;align-items:center;justify-content:center}
button[aria-selected=true]{background:var(--ui-bg-accented);color:var(--ui-text-highlighted);box-shadow:inset 0 -2px 0 var(--ui-primary)}
button:hover{background:var(--ui-bg-elevated);color:var(--ui-text-highlighted)}
button:focus-visible{outline:2px solid var(--ui-primary);outline-offset:3px}
button::after{content:attr(aria-label);position:absolute;top:calc(100% + 6px);right:0;white-space:nowrap;padding:5px 8px;background:var(--ui-bg-inverted);color:var(--ui-text-inverted);border-radius:var(--radius-sm);font-size:12px;opacity:0;pointer-events:none;z-index:10}
button:hover::after,button:focus-visible::after{opacity:1}
</style>
