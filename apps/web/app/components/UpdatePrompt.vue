<script setup lang="ts">
const { $pwa, $db: db } = useNuxtApp();
// needRefresh: a new service worker waits. stale: a message from another
// build reached this tab (an old tab, or an old leader serving a new one).
const needRefresh = computed(() => $pwa?.needRefresh ?? false);
const show = computed(() => needRefresh.value || (db?.stale.value ?? false));
const reload = () =>
  needRefresh.value ? $pwa!.updateServiceWorker(true) : location.reload();
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
