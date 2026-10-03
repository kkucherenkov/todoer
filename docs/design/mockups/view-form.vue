<!-- Reconciliation reference: preserves current source composables and write contracts. -->
<script setup lang="ts">
import { filterProblem, type Catalog, type Filter } from '@todoer/client-core';
import type { ViewFields } from '@todoer/client-core';
import FilterTree from './references/FilterTree.vue';
import { editable } from '~/utils/filterTree';
import { filterOf, type Template } from '~/utils/templates';

type View = Catalog['views'][number];

const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{ view?: View }>();
const db = useDb();
const fail = useFail();
const { t } = useI18n();
const catalog = useTopic('catalog');

const STARTS = [
  'today',
  'overdue',
  'next7',
  'project',
  'tag',
  'status',
] as const;
const LAYOUTS = ['list', 'kanban', 'calendar'] as const;
const SORTS = ['manual', 'priority', 'due', 'scheduled'] as const;

const name = ref('');
// Never reactive inside: the edit helpers keep untouched subtrees identical.
const filter = shallowRef<unknown>({});
const layout = ref<ViewFields['layout']>('list');
const sort = ref<ViewFields['sort']>('manual');
const raw = ref(false);
const text = ref('');
const saving = ref(false);

/** A "…" start holds the catalog's first id, so it is a leaf to change, not
 *  an empty one to fill. */
function start(kind: (typeof STARTS)[number]): Template {
  const c = catalog.value;
  switch (kind) {
    case 'project':
      return { kind, id: c?.projects[0]?.id ?? null };
    case 'tag':
      return { kind, id: c?.tags[0]?.id ?? '' };
    case 'status':
      return { kind, id: c?.statuses[0]?.id ?? '' };
    default:
      return { kind };
  }
}
const starts = computed(() => STARTS.map((k) => ({
  label: t(`viewForm.kinds.${k}`),
  onSelect: () => {
    filter.value = filterOf(start(k));
  },
})));

/** The filter, or why it is not one: the same check the server runs. */
const parsed = computed<{ filter?: unknown; problem: string | null }>(() => {
  if (!raw.value) {
    return { filter: filter.value, problem: filterProblem(filter.value) };
  }
  try {
    const value: unknown = JSON.parse(text.value);
    return { filter: value, problem: filterProblem(value) };
  } catch (e) {
    return { problem: (e as Error).message };
  }
});

watch(open, (now) => {
  if (!now) return;
  const v = props.view;
  name.value = v?.name ?? '';
  layout.value = (v?.layout as ViewFields['layout']) ?? 'list';
  sort.value = (v?.sort as ViewFields['sort']) ?? 'manual';
  filter.value = v ? v.filter : filterOf({ kind: 'today' });
  raw.value = !editable(filter.value);
  text.value = JSON.stringify(filter.value, null, 2);
});

/** The raw box leaves for the tree only when it parses into one. */
const rawIsTree = computed(() => editable(parsed.value.filter));

function toggle(on: boolean) {
  if (on) text.value = JSON.stringify(filter.value, null, 2);
  else filter.value = parsed.value.filter;
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

        <UFormField :label="$t('viewForm.filter')">
          <div v-if="!raw" class="flex flex-col gap-3">
            <UDropdownMenu :items="starts" class="self-start">
              <UButton
                variant="outline"
                color="neutral"
                trailing-icon="i-lucide-chevron-down"
                data-testid="start-from"
              >
                {{ $t('viewForm.startFrom') }}
              </UButton>
            </UDropdownMenu>
            <FilterTree
              :model-value="filter as Filter"
              @update:model-value="filter = $event"
            />
          </div>
          <UTextarea
            v-else
            v-model="text"
            :rows="6"
            class="w-full font-mono"
            :aria-label="$t('viewForm.filter')"
            data-testid="view-filter"
          />
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
          :disabled="raw && !rawIsTree"
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
