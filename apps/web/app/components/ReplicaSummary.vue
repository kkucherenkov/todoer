<script setup lang="ts">
import type { Db } from '~/db/client';

const { db } = defineProps<{ db: Db }>();
const { locale, t } = useI18n();
const summary = computed(() => db.topics.summary.value);
const sync = computed(() => db.topics.sync.value);

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
  <section class="flex max-w-sm flex-col gap-3">
    <p class="text-3xl font-semibold" data-testid="task-count">{{ tasks }}</p>
    <p class="text-sm" data-testid="last-synced">{{ lastSynced }}</p>
    <div class="flex flex-wrap gap-2">
      <UBadge
        v-if="sync?.reached === false"
        color="warning"
        data-testid="offline"
      >
        {{ $t('summary.offline') }}
      </UBadge>
      <UBadge color="neutral" variant="subtle" data-testid="pending">
        {{ $t('summary.pending', { n: sync?.pending ?? 0 }) }}
      </UBadge>
      <UBadge
        :color="sync?.failed ? 'error' : 'neutral'"
        variant="subtle"
        data-testid="failed"
      >
        {{ $t('summary.failed', { n: sync?.failed ?? 0 }) }}
      </UBadge>
    </div>
    <div class="flex gap-2">
      <UButton
        :loading="sync?.running"
        data-testid="sync-now"
        @click="db.request({ kind: 'sync', reason: 'manual' })"
      >
        {{ $t('summary.syncNow') }}
      </UButton>
      <UButton
        variant="outline"
        data-testid="sign-out"
        @click="db.request({ kind: 'signOut' })"
      >
        {{ $t('summary.signOut') }}
      </UButton>
    </div>
  </section>
</template>
