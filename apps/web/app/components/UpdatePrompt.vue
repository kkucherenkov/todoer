<script setup lang="ts">
const nuxtApp = useNuxtApp();
const { $pwa } = nuxtApp;
// needRefresh: a new service worker waits. outdated: Nuxt's manifest check
// saw a newer build; kept in state, so a prompt mounted later still shows.
const outdated = useState('todoer.outdated', () => false);
onScopeDispose(
  nuxtApp.hook('app:manifest:update', () => void (outdated.value = true)),
);
const needRefresh = computed(() => $pwa?.needRefresh ?? false);
const show = computed(() => needRefresh.value || outdated.value);
// Outdated before the worker found the new build: fetch that worker first,
// or the reload would land on the old build again.
const reload = () =>
  needRefresh.value
    ? $pwa!.updateServiceWorker(true)
    : reloadOntoNewBuild(
        navigator.serviceWorker,
        () => $pwa!.updateServiceWorker(true),
        () => location.reload(),
      );
</script>

<template>
  <UAlert
    v-if="show"
    color="info"
    variant="subtle"
    data-testid="update-available"
    :title="$t('update.title')"
    :description="$t('update.body')"
    :actions="[{ label: $t('update.reload'), onClick: reload }]"
  />
</template>
