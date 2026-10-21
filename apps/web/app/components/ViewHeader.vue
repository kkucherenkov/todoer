<script setup lang="ts">
import { ALL } from '@todoer/client-core';
import type { Layout } from '~/utils/layout';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const catalog = useTopic('catalog');
const shown = useTopic('view');

const key = computed(() =>
  route.path === '/' ? ALL : String(route.params.id ?? ''),
);
// The published view names the layout it was projected with; the saved one
// is the catalog's. A switch rewatches and clears the view topic, so the
// mode group waits on the catalog, never on that topic: it keeps its focus.
const ready = computed(() => catalog.value !== undefined);
const saved = computed(() => savedLayoutOf(key.value, catalog.value?.views));
const resolved = computed(() => resolveLayout(route.query.layout, saved.value));
const current = computed(() => resolved.value.layout);
const title = computed(() => {
  if (key.value === ALL) return t('nav.all');
  return catalog.value?.views.find((view) => view.id === key.value)?.name ?? '';
});
const count = computed(() => {
  const n = shown.value?.items.length ?? 0;
  return t(`summary.tasks.${pluralForm(locale.value, n)}`, { n });
});

watch(
  [() => route.query.layout, ready, saved],
  () => {
    if (!ready.value || !resolved.value.normalize) return;
    void router.replace({
      query: { ...route.query, layout: resolved.value.override },
    });
  },
  { immediate: true },
);

function choose(layout: Layout) {
  if (!ready.value) return;
  void router.push({ query: layoutQuery(route.query, saved.value, layout) });
}
</script>

<template>
  <header class="view-header" data-testid="view-header">
    <div class="min-w-0">
      <p class="view-kicker">{{ $t('nav.title') }}</p>
      <h1
        tabindex="-1"
        class="view-title"
        data-workspace-heading
        data-testid="view-title"
      >
        {{ title }}
      </h1>
    </div>
    <ViewModeTabs v-if="ready" :layout="current" @change="choose" />
    <p v-if="shown?.key === key" class="view-count">{{ count }}</p>
  </header>
</template>
