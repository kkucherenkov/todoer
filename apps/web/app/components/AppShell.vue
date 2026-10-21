<script setup lang="ts">
const db = useDb();
const sync = useTopic('sync');
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar>
      <template #header>
        <h1 class="text-lg font-semibold">{{ $t('app.title') }}</h1>
      </template>
      <ViewNav />
      <template #footer>
        <div class="flex w-full flex-col gap-3">
          <SyncStatus />
          <LocaleSwitch />
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <template #header>
        <UDashboardNavbar :title="$t('app.title')" />
        <ViewHeader />
        <!-- The prototype's #alerts: the sync problem and the update. -->
        <div
          class="flex flex-col gap-3 px-4 pt-4 empty:hidden"
          data-testid="alerts"
        >
          <UAlert
            v-if="sync?.problem && sync.reached !== false"
            color="error"
            variant="subtle"
            data-testid="sync-problem"
            :title="$t('errors.syncProblem')"
            :description="sync.problem"
            :actions="[
              {
                label: $t('summary.syncNow'),
                onClick: () => db.request({ kind: 'sync', reason: 'manual' }),
              },
            ]"
          />
          <UpdatePrompt />
        </div>
      </template>
      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
    <TaskDrawer />
  </UDashboardGroup>
</template>
