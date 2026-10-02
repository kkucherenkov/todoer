<script setup lang="ts">
import { filterProblem, type Catalog } from '@todoer/client-core';
import type { ViewFields } from '@todoer/client-core';
import { filterOf, templateOf, type Template } from '~/utils/templates';

type View = Catalog['views'][number];

const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{ view?: View }>();
const db = useDb();
const fail = useFail();
const { t } = useI18n();
const catalog = useTopic('catalog');

const KINDS = [
  'today',
  'overdue',
  'next7',
  'project',
  'tag',
  'status',
] as const;
const LAYOUTS = ['list', 'kanban'] as const;
const SORTS = ['manual', 'priority', 'due', 'scheduled'] as const;
/** A select cannot hold null or ''. */
const NONE = 'none';

const name = ref('');
const kind = ref<Template['kind']>('today');
const picked = ref('');
const layout = ref<ViewFields['layout']>('list');
const sort = ref<ViewFields['sort']>('manual');
const raw = ref(false);
const text = ref('');
const saving = ref(false);

const options = computed(() => {
  const c = catalog.value;
  const named = (rows: { id: string; name: string }[] = []) =>
    rows.map((r) => ({ label: r.name, value: r.id }));
  return {
    project: [
      { label: t('viewForm.noProject'), value: NONE },
      ...named(c?.projects),
    ],
    tag: named(c?.tags),
    status: named(c?.statuses),
  };
});

/** The template the radio and picker say, or null while a picker is empty. */
const template = computed<Template | null>(() => {
  const k = kind.value;
  if (k === 'project') {
    return picked.value === ''
      ? null
      : { kind: k, id: picked.value === NONE ? null : picked.value };
  }
  if (k === 'tag' || k === 'status') {
    return picked.value === '' ? null : { kind: k, id: picked.value };
  }
  return { kind: k };
});

/** The text parsed, or why it is not a filter: the same check the server runs. */
const parsed = computed<{ filter?: unknown; problem: string | null }>(() => {
  if (!raw.value) {
    const tpl = template.value;
    return tpl
      ? { filter: filterOf(tpl), problem: null }
      : { problem: t('viewForm.pick') };
  }
  try {
    const filter: unknown = JSON.parse(text.value);
    return { filter, problem: filterProblem(filter) };
  } catch (e) {
    return { problem: (e as Error).message };
  }
});

function load(tpl: Template | null) {
  kind.value = tpl?.kind ?? 'today';
  picked.value = tpl && 'id' in tpl ? (tpl.id ?? NONE) : '';
}

watch(open, (now) => {
  if (!now) return;
  const v = props.view;
  name.value = v?.name ?? '';
  layout.value = (v?.layout as ViewFields['layout']) ?? 'list';
  sort.value = (v?.sort as ViewFields['sort']) ?? 'manual';
  const tpl = v ? templateOf(v.filter) : { kind: 'today' as const };
  raw.value = tpl === null;
  text.value = JSON.stringify(v?.filter ?? {}, null, 2);
  load(tpl);
});

/** Picking a "…" template selects its first choice, so Save is never blocked
 *  by an unnoticed empty picker. */
watch(kind, (k) => {
  if (k === 'today' || k === 'overdue' || k === 'next7') return;
  if (!options.value[k].some((o) => o.value === picked.value)) {
    picked.value = options.value[k][0]?.value ?? '';
  }
});

/** The raw box leaves for the radio only when it is exactly a template. */
const rawIsTemplate = computed(() => templateOf(parsed.value.filter) !== null);
function toggle(on: boolean) {
  if (on) {
    text.value = JSON.stringify(parsed.value.filter ?? {}, null, 2);
  } else {
    load(templateOf(parsed.value.filter));
  }
  raw.value = on;
}

const canSave = computed(
  () =>
    parsed.value.problem === null && name.value.trim() !== '' && !saving.value,
);

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  const w = db.mint({
    kind: 'saveView',
    ...(props.view && { id: props.view.id }),
    fields: {
      name: name.value,
      layout: layout.value,
      sort: sort.value,
      filter: parsed.value.filter,
    },
  });
  const result = await db.write(w);
  saving.value = false;
  if (!result.ok) return fail(result);
  open.value = false;
  if (!props.view && w.kind === 'saveView') await navigateTo(`/views/${w.id}`);
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="view ? $t('viewForm.editTitle') : $t('viewForm.newTitle')"
    :description="$t('viewForm.description')"
  >
    <template #body>
      <UForm :state="{}" class="flex flex-col gap-4" @submit="save">
        <UFormField :label="$t('viewForm.name')">
          <UInput v-model="name" class="w-full" data-testid="view-name" />
        </UFormField>

        <UFormField :label="$t('viewForm.template')">
          <div v-if="!raw" class="flex flex-col gap-2">
            <URadioGroup
              v-model="kind"
              :items="
                KINDS.map((k) => ({
                  label: $t(`viewForm.kinds.${k}`),
                  value: k,
                }))
              "
            />
            <USelect
              v-if="kind === 'project' || kind === 'tag' || kind === 'status'"
              v-model="picked"
              :items="options[kind]"
              :aria-label="$t(`viewForm.kinds.${kind}`)"
              :placeholder="$t('viewForm.pick')"
              class="w-full"
              data-testid="view-picker"
            />
          </div>
          <div v-else class="flex flex-col gap-1">
            <UTextarea
              v-model="text"
              :rows="6"
              class="w-full font-mono"
              :aria-label="$t('viewForm.filter')"
              data-testid="view-filter"
            />
          </div>
        </UFormField>

        <p
          v-if="parsed.problem !== null"
          class="text-sm text-error"
          role="alert"
          data-testid="filter-problem"
        >
          {{ parsed.problem }}
        </p>

        <USwitch
          :model-value="raw"
          :label="$t('viewForm.raw')"
          :disabled="raw && !rawIsTemplate"
          data-testid="view-raw"
          @update:model-value="toggle"
        />

        <UFormField :label="$t('viewForm.layout')">
          <URadioGroup
            v-model="layout"
            orientation="horizontal"
            :items="[
              ...LAYOUTS.map((l) => ({
                label: $t(`viewForm.layouts.${l}`),
                value: l,
              })),
              {
                label: $t('viewForm.layouts.calendar'),
                description: $t('viewForm.soon'),
                value: 'calendar',
                disabled: true,
              },
            ]"
          />
        </UFormField>

        <UFormField :label="$t('viewForm.sort')">
          <USelect
            v-model="sort"
            :items="
              SORTS.map((s) => ({ label: $t(`viewForm.sorts.${s}`), value: s }))
            "
            class="w-full"
            data-testid="view-sort"
          />
        </UFormField>

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="open = false">
            {{ $t('viewForm.cancel') }}
          </UButton>
          <UButton type="submit" :disabled="!canSave" data-testid="view-save">
            {{ $t('viewForm.save') }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
