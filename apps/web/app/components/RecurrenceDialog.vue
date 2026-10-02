<script setup lang="ts">
import {
  localDate,
  ruleProblem,
  upcoming,
  WEEKDAYS,
  type TaskDetails,
  type Weekday,
} from '@todoer/client-core';
import {
  blankPreset,
  presetOf,
  reasonKey,
  toRrule,
  type Freq,
} from '~/utils/recurrence';

const props = defineProps<{ open: boolean; task: TaskDetails }>();
const emit = defineEmits<{ close: [] }>();

const db = useDb();
const fail = useFail();
const { t, locale } = useI18n();

type Mode = 'none' | Freq | 'custom';
const mode = ref<Mode>('none');
const interval = ref<number | null>(1);
const byDay = ref<Weekday[]>([]);
const start = ref('');
const text = ref('');
const saving = ref(false);
const today = ref('');

// Opening: the task's rule as a preset when the presets write it exactly,
// else the raw field with its text unchanged.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const { rrule, dtstart, scheduledOn } = props.task;
    today.value = localDate(new Date());
    start.value = String(dtstart ?? scheduledOn ?? today.value);
    const blank = blankPreset(start.value);
    const preset = rrule ? presetOf(rrule) : blankPreset(start.value);
    mode.value = !rrule ? 'none' : preset ? preset.freq : 'custom';
    interval.value = (preset ?? blank).interval;
    byDay.value = preset?.byDay.length ? preset.byDay : blank.byDay;
    text.value = rrule ?? toRrule(blank) ?? '';
  },
  { immediate: true },
);

const isPreset = computed(
  () => mode.value !== 'none' && mode.value !== 'custom',
);
const rule = computed(() =>
  mode.value === 'none'
    ? null
    : mode.value === 'custom'
      ? text.value
      : toRrule({
          freq: mode.value,
          interval: interval.value,
          byDay: byDay.value,
        }),
);
// The parser's and ruleProblem's reasons are English; known ones are
// translated, the rest show as they are.
const localized = (reason: string | null) => {
  const known = reason === null ? null : reasonKey(reason);
  return known ? t(known.key, known.params) : reason;
};
const problem = computed(() => {
  const r = rule.value;
  if (mode.value === 'none') return null;
  if (r === null) return t('recurrence.pickInterval');
  if (mode.value === 'WEEKLY' && byDay.value.length === 0)
    return t('recurrence.pickDay');
  return localized(ruleProblem(r, start.value));
});
const dates = computed(() =>
  rule.value === null || problem.value !== null
    ? []
    : upcoming(rule.value, start.value, today.value),
);
const changed = computed(() =>
  rule.value === null
    ? !!props.task.rrule
    : rule.value !== props.task.rrule || start.value !== props.task.dtstart,
);

const modes = computed(() => [
  { label: t('recurrence.none'), value: 'none' },
  ...(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((f) => ({
    label: t(`recurrence.${f}`),
    value: f,
  })),
  { label: t('recurrence.custom'), value: 'custom' },
]);
const unit = computed(() =>
  isPreset.value
    ? t(`recurrence.unit.${mode.value}`, { n: interval.value })
    : '',
);
const days = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    timeZone: 'UTC',
  });
  // 2024-01-01 is a Monday.
  return WEEKDAYS.map((value, i) => ({
    value,
    label: fmt.format(new Date(Date.UTC(2024, 0, 1 + i))),
  }));
});
const long = (date: string) =>
  new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(date));

// Leaving a preset for the raw field keeps the text the preset wrote.
function pick(value: string) {
  const now = value as Mode;
  if (now === 'custom' && isPreset.value && rule.value !== null)
    text.value = rule.value;
  mode.value = now;
}

async function save() {
  saving.value = true;
  const result = await db.write({
    kind: 'setRule',
    taskId: String(props.task.id),
    rule:
      rule.value === null ? null : { rrule: rule.value, dtstart: start.value },
  });
  saving.value = false;
  if (result.ok) emit('close');
  else fail(result);
}
</script>

<template>
  <UModal
    :open="open"
    :title="$t('recurrence.title')"
    :description="$t('recurrence.description')"
    :ui="{ description: 'sr-only' }"
    @update:open="(o) => !o && emit('close')"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <UFormField :label="$t('recurrence.repeat')">
          <USelect
            :model-value="mode"
            class="w-full"
            :items="modes"
            value-key="value"
            @update:model-value="pick"
          />
        </UFormField>
        <UFormField v-if="isPreset" :label="$t('recurrence.every')">
          <div class="flex items-center gap-2">
            <UInputNumber v-model="interval" :min="1" />
            <span>{{ unit }}</span>
          </div>
        </UFormField>
        <UCheckboxGroup
          v-if="mode === 'WEEKLY'"
          v-model="byDay"
          :legend="$t('recurrence.on')"
          orientation="horizontal"
          :items="days"
        />
        <UFormField v-if="mode !== 'none'" :label="$t('recurrence.starts')">
          <UInput v-model="start" type="date" />
        </UFormField>
        <UFormField v-if="mode === 'custom'" :label="$t('recurrence.rrule')">
          <UInput v-model="text" class="w-full font-mono" />
        </UFormField>
        <UAlert
          v-if="problem"
          color="error"
          variant="subtle"
          role="alert"
          data-testid="rule-problem"
          :title="problem"
        />
        <ol v-else-if="dates.length" class="text-sm" data-testid="rule-preview">
          <li v-for="date in dates" :key="date">
            <time :datetime="date">{{ long(date) }}</time>
          </li>
        </ol>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="emit('close')">
            {{ $t('recurrence.cancel') }}
          </UButton>
          <UButton
            type="submit"
            :disabled="!!problem || !changed"
            :loading="saving"
          >
            {{ $t('recurrence.save') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
