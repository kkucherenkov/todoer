<!-- Read-only source contract reference; not installed in the application. -->
<script setup lang="ts">
import type { Catalog, Filter } from '@todoer/client-core';
import {
  append,
  blank,
  canAdd,
  canToggleNot,
  children,
  options,
  remove,
  replace,
  setGroup,
  toggleNot,
  TREE,
  type LeafKind,
  type Path,
} from '~/utils/filterTree';

const props = defineProps<{ node: Filter; path: Path }>();
const { root, edit } = inject(TREE)!;
const { t } = useI18n();
const catalog = useTopic('catalog');

const LEAVES = [
  'tag',
  'project',
  'status',
  'priority',
  'scheduled',
  'due',
  'recurring',
] as const satisfies readonly LeafKind[];
const PRIORITIES = [0, 1, 2, 3, 4];
/** A select cannot hold null or ''. */
const NONE = 'none';

/** The node under any `not`s: a `not` is a switch on its row, not a row. */
const core = computed(() => {
  let node = props.node;
  const path = [...props.path];
  while ('not' in node) {
    node = node.not;
    path.push(0);
  }
  return { node, path, negated: path.length > props.path.length };
});
const id = computed(() => ['n', ...props.path].join('-'));
const isGroup = computed(
  () => 'and' in core.value.node || 'or' in core.value.node,
);
const kind = computed(() => Object.keys(core.value.node)[0] as string);

const rows = computed<Catalog>(
  () => catalog.value ?? { views: [], statuses: [], projects: [], tags: [] },
);

const choices = (list: { id: string; name: string }[], value: string) =>
  options(list, value, t('filterTree.unknown'));

const set = (leaf: Filter) => edit((r) => replace(r, core.value.path, leaf));
const add = (what: LeafKind | 'and') =>
  edit((r) => append(r, core.value.path, blank(what, rows.value)));

const addItems = computed(() =>
  [...LEAVES, 'and' as const].map((k) => ({
    label: t(`filterTree.add.${k}`),
    onSelect: () => add(k),
  })),
);

type Bound = number | string | undefined;
type Range = { from?: Bound; to?: Bound };
const range = computed(
  () => (core.value.node as Record<string, Range>)[kind.value] ?? {},
);
const boundKind = (b: Bound) =>
  b === undefined ? 'none' : typeof b === 'number' ? 'offset' : 'date';
function setBound(side: 'from' | 'to', value: Bound) {
  const { [side]: _dropped, ...rest } = range.value;
  const next = value === undefined ? rest : { ...range.value, [side]: value };
  set({ [kind.value]: next } as Filter);
}
const FRESH = { none: undefined, offset: 0, date: '' } as const;
</script>

<template>
  <div class="flex flex-col gap-2" :data-testid="`node-${id}`">
    <div class="flex flex-wrap items-center gap-2">
      <template v-if="isGroup">
        <USelect
          :model-value="'and' in core.node ? 'and' : 'or'"
          :items="[
            { label: $t('filterTree.and'), value: 'and' },
            { label: $t('filterTree.or'), value: 'or' },
          ]"
          :aria-label="$t('filterTree.group')"
          :data-testid="`op-${id}`"
          @update:model-value="
            edit((r) => setGroup(r, core.path, $event as 'and' | 'or'))
          "
        />
      </template>
      <template v-else>
        <span class="text-sm font-medium">
          {{ $t(`filterTree.add.${kind}`) }}
        </span>

        <USelect
          v-if="'tag' in core.node"
          :model-value="core.node.tag.toLowerCase()"
          :items="choices(rows.tags, core.node.tag)"
          :aria-label="$t('filterTree.add.tag')"
          :data-testid="`value-${id}`"
          @update:model-value="set({ tag: $event.toLowerCase() })"
        />
        <USelect
          v-else-if="'status' in core.node"
          :model-value="core.node.status.toLowerCase()"
          :items="choices(rows.statuses, core.node.status)"
          :aria-label="$t('filterTree.add.status')"
          :data-testid="`value-${id}`"
          @update:model-value="set({ status: $event.toLowerCase() })"
        />
        <USelect
          v-else-if="'project' in core.node"
          :model-value="core.node.project?.toLowerCase() ?? NONE"
          :items="[
            { label: $t('viewForm.noProject'), value: NONE },
            ...choices(rows.projects, core.node.project ?? ''),
          ]"
          :aria-label="$t('filterTree.add.project')"
          :data-testid="`value-${id}`"
          @update:model-value="
            set({ project: $event === NONE ? null : $event.toLowerCase() })
          "
        />
        <UCheckboxGroup
          v-else-if="'priority' in core.node"
          :model-value="core.node.priority.map(String)"
          :items="PRIORITIES.map((p) => ({ label: `p${p}`, value: String(p) }))"
          orientation="horizontal"
          :data-testid="`value-${id}`"
          @update:model-value="
            set({ priority: $event.map(Number).sort((a, b) => a - b) })
          "
        />
        <USelect
          v-else-if="'recurring' in core.node"
          :model-value="core.node.recurring ? 'yes' : 'no'"
          :items="[
            { label: $t('filterTree.yes'), value: 'yes' },
            { label: $t('filterTree.no'), value: 'no' },
          ]"
          :aria-label="$t('filterTree.add.recurring')"
          :data-testid="`value-${id}`"
          @update:model-value="set({ recurring: $event === 'yes' })"
        />
        <div v-else class="flex flex-wrap items-center gap-2">
          <div
            v-for="side in ['from', 'to'] as const"
            :key="side"
            class="flex items-center gap-1"
          >
            <span class="text-sm text-muted">{{
              $t(`filterTree.${side}`)
            }}</span>
            <USelect
              :model-value="boundKind(range[side])"
              :items="
                (['none', 'offset', 'date'] as const).map((b) => ({
                  label: $t(`filterTree.bound.${b}`),
                  value: b,
                }))
              "
              :aria-label="`${$t(`filterTree.${side}`)}: ${$t('filterTree.bound.label')}`"
              :data-testid="`${side}-kind-${id}`"
              @update:model-value="setBound(side, FRESH[$event])"
            />
            <UInputNumber
              v-if="typeof range[side] === 'number'"
              :model-value="range[side]"
              :aria-label="`${$t(`filterTree.${side}`)}: ${$t('filterTree.bound.offset')}`"
              :data-testid="`${side}-offset-${id}`"
              @update:model-value="$event !== null && setBound(side, $event)"
            />
            <UInput
              v-else-if="typeof range[side] === 'string'"
              type="date"
              :model-value="range[side]"
              :aria-label="`${$t(`filterTree.${side}`)}: ${$t('filterTree.bound.date')}`"
              :data-testid="`${side}-date-${id}`"
              @update:model-value="setBound(side, String($event))"
            />
          </div>
          <span class="text-xs text-muted">{{ $t('filterTree.hint') }}</span>
        </div>
      </template>

      <USwitch
        :model-value="core.negated"
        :label="$t('filterTree.not')"
        :disabled="!canToggleNot(root, path)"
        :data-testid="`not-${id}`"
        @update:model-value="edit((r) => toggleNot(r, path))"
      />
      <UDropdownMenu v-if="isGroup" :items="addItems">
        <UButton
          variant="outline"
          color="neutral"
          size="sm"
          icon="i-lucide-plus"
          :disabled="!canAdd(root, core.path)"
          :data-testid="`add-${id}`"
        >
          {{ $t('filterTree.addLabel') }}
        </UButton>
      </UDropdownMenu>
      <UButton
        v-if="path.length > 0"
        variant="ghost"
        color="neutral"
        size="sm"
        icon="i-lucide-trash-2"
        :aria-label="$t('filterTree.remove')"
        :data-testid="`remove-${id}`"
        @click="edit((r) => remove(r, core.path))"
      />
    </div>

    <div
      v-if="isGroup"
      class="ml-2 flex flex-col gap-2 border-l border-default pl-3"
    >
      <FilterNode
        v-for="(child, i) in children(core.node)"
        :key="i"
        :node="child"
        :path="[...core.path, i]"
      />
    </div>
  </div>
</template>
