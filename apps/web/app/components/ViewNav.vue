<script setup lang="ts">
import { PROJECT_PREFIX, TAG_PREFIX } from '@todoer/client-core';
import type { NavigationMenuItem } from '@nuxt/ui';

const { t } = useI18n();
const catalog = useTopic('catalog');
const route = useRoute();
const creating = ref(false);

// Literal names: the icon bundle is built by scanning the source.
const ICONS: Record<string, string> = {
  list: 'i-lucide-list',
  kanban: 'i-lucide-kanban',
  calendar: 'i-lucide-calendar',
  all: 'i-lucide-inbox',
  today: 'i-lucide-calendar-check',
  upcoming: 'i-lucide-calendar-clock',
  project: 'i-lucide-folder',
  tag: 'i-lucide-tag',
};

const link = (path: string) => ({
  to: { path, query: viewQuery(route.query) },
  // Exact: the link of the shown destination carries aria-current.
  exact: true,
});

const items = computed<NavigationMenuItem[][]>(() => {
  const entries = navEntries(catalog.value).map((e) => ({
    ...link(e.path),
    label: e.name ?? t(`nav.${e.key}`),
    icon: e.key.startsWith(TAG_PREFIX)
      ? ICONS.tag
      : e.name === null
        ? ICONS[e.key]
        : ICONS.project,
    badge: e.count,
    project: e.key.startsWith(PROJECT_PREFIX),
    tag: e.key.startsWith(TAG_PREFIX),
  }));
  const label = (text: string) => ({ label: text, type: 'label' as const });
  const projects = entries.filter((e) => e.project);
  const tags = entries.filter((e) => e.tag);
  const views = (catalog.value?.views ?? []).map((v) => ({
    ...link(navPath(v.id)),
    label: v.name,
    icon: ICONS[v.layout] ?? ICONS.list,
    ...(v.problem !== null && {
      trailingIcon: 'i-lucide-triangle-alert',
      ui: { linkTrailingIcon: 'text-warning' },
    }),
  }));
  return [
    entries.filter((e) => !e.project && !e.tag),
    projects.length ? [label(t('nav.projects')), ...projects] : [],
    tags.length ? [label(t('nav.tags')), ...tags] : [],
    views.length ? [label(t('nav.saved')), ...views] : [],
  ].filter((group) => group.length > 0);
});
</script>

<template>
  <div class="flex flex-col gap-2">
    <UNavigationMenu
      orientation="vertical"
      :items="items"
      :aria-label="$t('nav.title')"
      :ui="{ linkLabel: 'whitespace-normal [overflow-wrap:anywhere]' }"
      data-testid="nav"
    />
    <UButton
      variant="ghost"
      color="neutral"
      icon="i-lucide-plus"
      data-testid="new-view"
      @click="creating = true"
    >
      {{ $t('viewForm.new') }}
    </UButton>
    <ViewForm v-model:open="creating" />
  </div>
</template>
