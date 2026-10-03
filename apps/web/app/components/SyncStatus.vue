<script setup lang="ts">
const db = useDb();
const { locale, t } = useI18n();
const summary = useTopic('summary');
const sync = useTopic('sync');

// The relative time must age without a new publish.
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 10_000);
onScopeDispose(() => clearInterval(clock));

const tasks = computed(() => {
  const n = summary.value?.tasks ?? 0;
  return t(`summary.tasks.${pluralForm(locale.value, n)}`, { n });
});

const lastSynced = computed(() => {
  const at = sync.value?.lastSyncedAt;
  if (!at) return t('summary.neverSynced');
  const seconds = Math.min(0, Math.round((Date.parse(at) - now.value) / 1000));
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds > -60
      ? [seconds, 'second']
      : seconds > -3600
        ? [Math.round(seconds / 60), 'minute']
        : [Math.round(seconds / 3600), 'hour'];
  const when = new Intl.RelativeTimeFormat(locale.value, {
    numeric: 'auto',
  }).format(value, unit);
  return t('summary.lastSynced', { when });
});
</script>

<template>
  <section class="flex w-full flex-col gap-2">
    <p class="text-lg font-semibold" data-testid="task-count">{{ tasks }}</p>
    <p class="text-xs" data-testid="last-synced">{{ lastSynced }}</p>
    <div class="flex flex-wrap gap-2">
      <UBadge
        v-if="sync?.reached === false"
        color="warning"
        data-testid="offline"
      >
        {{ $t('summary.offline') }}
      </UBadge>
      <UBadge
        v-if="sync?.pending"
        color="neutral"
        variant="subtle"
        data-testid="pending"
      >
        {{ $t('summary.pending', { n: sync.pending }) }}
      </UBadge>
      <UBadge
        v-if="sync?.failed && sync.reached !== false && !sync.problem"
        color="error"
        variant="subtle"
        data-testid="failed"
      >
        {{ $t('summary.failed', { n: sync.failed }) }}
      </UBadge>
    </div>
    <div class="flex gap-2">
      <UButton
        size="sm"
        :loading="sync?.running ?? false"
        data-testid="sync-now"
        @click="db.request({ kind: 'sync', reason: 'manual' })"
      >
        {{ $t('summary.syncNow') }}
      </UButton>
      <UButton
        size="sm"
        variant="outline"
        data-testid="sign-out"
        @click="db.request({ kind: 'signOut' })"
      >
        {{ $t('summary.signOut') }}
      </UButton>
    </div>
  </section>
</template>
