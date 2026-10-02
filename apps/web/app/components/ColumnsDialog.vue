<script setup lang="ts">
import type { Catalog, Item } from '@todoer/client-core';
import type { Draft } from '~/db/client';

type Status = Catalog['statuses'][number];

const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{ items: Item[] }>();
const db = useDb();
const fail = useFail();
const { t, locale } = useI18n();
const catalog = useTopic('catalog');
const statuses = computed(() => catalog.value?.statuses ?? []);

/** One write; the core's refusals (a duplicate name, the completing or the
 *  last open column deleted) show as its `invalid` message. */
async function run(draft: Draft): Promise<boolean> {
  const result = await db.write(draft);
  if (!result.ok) fail(result);
  return result.ok;
}

async function rename(s: Status, e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.value.trim() === s.name) return;
  if (!(await run({ kind: 'saveStatus', id: s.id, name: input.value }))) {
    input.value = s.name;
  }
}

const reorder = (i: number, to: 'up' | 'down') =>
  run({
    kind: 'saveStatus',
    id: statuses.value[i]!.id,
    after:
      to === 'up'
        ? (statuses.value[i - 2]?.id ?? null)
        : statuses.value[i + 1]!.id,
  });

const deleting = ref<string | null>(null);
/** Where the deleted column's tasks go (views Q8): the first other one. */
const first = (s: Status) => statuses.value.find((x) => x.id !== s.id)?.name;
// ponytail: counts this board's cards only; a filtered view undercounts
// what deleteStatus moves. A per-status count in the catalog would be exact.
const moving = (s: Status) => {
  const n = props.items.filter((i) => i.column === s.id).length;
  return t(`summary.tasks.${pluralForm(locale.value, n)}`, { n });
};
async function remove(s: Status) {
  if (await run({ kind: 'deleteStatus', id: s.id })) deleting.value = null;
}

const name = ref('');
async function add() {
  if (name.value.trim() === '') return;
  if (await run({ kind: 'saveStatus', name: name.value })) name.value = '';
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('columns.title')"
    :description="$t('columns.description')"
  >
    <template #body>
      <ul class="flex flex-col gap-2">
        <li
          v-for="(s, i) in statuses"
          :key="s.id"
          :aria-label="s.name"
          class="flex flex-col gap-2"
        >
          <div class="flex items-center gap-1">
            <UInput
              :model-value="s.name"
              :aria-label="$t('columns.name')"
              class="flex-1"
              @change="rename(s, $event)"
            />
            <UIcon
              v-if="s.completing"
              name="i-lucide-circle-check"
              role="img"
              class="text-success"
              :aria-label="$t('kanban.completing')"
            />
            <UButton
              v-else
              variant="ghost"
              color="neutral"
              icon="i-lucide-circle-check"
              :aria-label="$t('columns.makeCompleting')"
              @click="run({ kind: 'setCompleting', id: s.id })"
            />
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-lucide-arrow-up"
              :disabled="i === 0"
              :aria-label="$t('list.moveUp')"
              @click="reorder(i, 'up')"
            />
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-lucide-arrow-down"
              :disabled="i === statuses.length - 1"
              :aria-label="$t('list.moveDown')"
              @click="reorder(i, 'down')"
            />
            <UButton
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              :aria-label="$t('columns.delete')"
              @click="deleting = s.id"
            />
          </div>
          <div
            v-if="deleting === s.id"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span>{{
              $t('columns.confirm', {
                name: s.name,
                first: first(s),
                count: moving(s),
              })
            }}</span>
            <UButton color="error" size="sm" @click="remove(s)">
              {{ $t('columns.confirmDelete') }}
            </UButton>
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              @click="deleting = null"
            >
              {{ $t('columns.cancel') }}
            </UButton>
          </div>
        </li>
      </ul>
      <form class="mt-4 flex gap-2" @submit.prevent="add">
        <UInput
          v-model="name"
          :aria-label="$t('columns.new')"
          :placeholder="$t('columns.new')"
          class="flex-1"
        />
        <UButton type="submit" icon="i-lucide-plus">
          {{ $t('columns.add') }}
        </UButton>
      </form>
    </template>
  </UModal>
</template>
