<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';

const { t } = useI18n();
const catalog = useTopic('catalog');

// Literal names: the icon bundle is built by scanning the source.
const ICONS: Record<string, string> = {
  list: 'i-lucide-list',
  kanban: 'i-lucide-kanban',
  calendar: 'i-lucide-calendar',
};

const items = computed<NavigationMenuItem[]>(() => [
  { label: t('nav.all'), icon: 'i-lucide-inbox', to: '/', exact: true },
  ...(catalog.value?.views ?? []).map((v) => ({
    label: v.name,
    icon: ICONS[v.layout] ?? ICONS.list,
    to: `/views/${v.id}`,
    ...(v.problem !== null && {
      trailingIcon: 'i-lucide-triangle-alert',
      ui: { linkTrailingIcon: 'text-warning' },
    }),
  })),
]);
</script>

<template>
  <UNavigationMenu
    orientation="vertical"
    :items="items"
    :aria-label="$t('nav.title')"
  />
</template>
