<script setup lang="ts">
import type { TaskChanges } from '@todoer/client-core';
import { ALL } from '~/db/protocol';

const db = useDb();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const fail = useFail();
const { t } = useI18n();
const topic = useTopic('task');
const catalog = useTopic('catalog');

const id = computed(() =>
  typeof route.query.task === 'string' ? route.query.task : null,
);
/** undefined: not published yet; null: deleted or unknown. */
const task = computed(() =>
  topic.value?.id === id.value ? topic.value.task : undefined,
);
// A live recurring task whose series ended has nothing left to edit.
const readonly = computed(
  () => !!task.value?.rrule && task.value.occurrence === null,
);
const recurring = computed(() => !!task.value?.rrule);
/** The occurrence this task is a moved copy of; null for any other task. */
const movedFrom = computed(() => {
  const k = task.value;
  return typeof k?.originTaskId === 'string' &&
    typeof k.originOccurrence === 'string'
    ? k.originOccurrence
    : null;
});

// What the server holds, as the fields show it.
const server = computed(() => {
  const k = task.value;
  if (!k) return null;
  return {
    title: String(k.title),
    notes: typeof k.notes === 'string' ? k.notes : '',
    project: k.project ?? '',
    tags: k.tags,
    priority: Number(k.priority),
    // A recurring task is scheduled by its current occurrence.
    scheduledOn: String((k.rrule ? k.occurrence : k.scheduledOn) ?? ''),
    dueOn: typeof k.dueOn === 'string' ? k.dueOn : '',
    statusId: k.column ?? '',
  };
});
type Draft = NonNullable<typeof server.value>;
const draft = reactive<Draft>({
  title: '',
  notes: '',
  project: '',
  tags: [],
  priority: 0,
  scheduledOn: '',
  dueOn: '',
  statusId: '',
});
// A field follows the server only when its own value changed, so typing in
// one field survives another's save.
for (const key of Object.keys(draft) as (keyof Draft)[]) {
  watch(
    () => JSON.stringify(server.value?.[key]),
    (json) =>
      json !== undefined && Object.assign(draft, { [key]: JSON.parse(json) }),
    { immediate: true },
  );
}

const close = () =>
  router.replace({ query: { ...route.query, task: undefined } });

// Leaving the drawer by any path commits the field being typed in: the blur
// handler runs before the route changes and the task topic is dropped.
const off = router.beforeEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
});
onScopeDispose(off);

// Deleted elsewhere while open: close, and say so.
const returning = ref(false);
watch(task, (now, before) => {
  if (now !== null || !before || returning.value) return;
  toast.add({ title: t('drawer.gone') });
  void close();
});

/** The copy is deleted and its occurrence reopened, so the drawer has
 *  nothing left to show; a refusal stays here with its reason. */
async function returnToSeries() {
  if (id.value === null) return;
  returning.value = true;
  const result = await db.write({ kind: 'undoMove', taskId: id.value });
  returning.value = false;
  if (result.ok) void close();
  else fail(result);
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** One field, one `edit` with one change; a refusal puts the field back. */
async function commit(key: keyof Draft, changes: TaskChanges) {
  const from = server.value;
  if (!from || id.value === null || same(draft[key], from[key])) return;
  const result = await db.write({ kind: 'edit', taskId: id.value, changes });
  if (result.ok) return;
  fail(result);
  Object.assign(draft, { [key]: structuredClone(toRaw(from[key])) });
}

function saveTitle() {
  draft.title = draft.title.trim();
  if (draft.title === '') draft.title = server.value?.title ?? '';
  else void commit('title', { title: draft.title });
}

const isDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;

function saveDate(key: 'scheduledOn' | 'dueOn') {
  const value = draft[key];
  if (value !== '' && !isDate(value)) {
    toast.add({ color: 'error', title: t('drawer.invalidDate') });
    draft[key] = server.value?.[key] ?? '';
    return;
  }
  void commit(key, { [key]: value === '' ? null : value });
}

function clearDate(key: 'scheduledOn' | 'dueOn') {
  draft[key] = '';
  saveDate(key);
}

const projectOpen = ref(false);
function createProject(name: string) {
  projectOpen.value = false;
  draft.project = name.trim();
  void commit('project', { project: draft.project });
}

function createTag(name: string) {
  const tag = name.trim().replace(/^@?/, '@');
  if (!draft.tags.includes(tag)) draft.tags = [...draft.tags, tag];
  void commit('tags', { tags: [...draft.tags] });
}

/** A status change is a `move`: the completing one is done, by the board's
 *  rule (current occurrence, statuses seeded), not a bare `statusId`. */
async function saveStatus() {
  const from = server.value;
  if (!from || id.value === null || draft.statusId === from.statusId) return;
  const result = await db.write({
    kind: 'move',
    taskId: id.value,
    view: ALL,
    statusId: draft.statusId,
  });
  if (!result.ok) {
    fail(result);
    draft.statusId = from.statusId;
  } else if (result.note?.occurrence && result.note.next) {
    toast.add({
      title: t('list.doneRecurring', {
        occurrence: result.note.occurrence,
        next: result.note.next,
      }),
    });
  }
}

const projects = computed(() => [
  { label: t('drawer.noProject'), value: '' },
  ...(catalog.value?.projects ?? []).map((p) => ({
    label: p.name,
    value: p.name,
  })),
]);
const tags = computed(() => (catalog.value?.tags ?? []).map((g) => g.name));
const statuses = computed(() =>
  (catalog.value?.statuses ?? []).map((s) => ({ label: s.name, value: s.id })),
);
const priorities = [0, 1, 2, 3, 4].map((n) => ({ label: `p${n}`, value: n }));
const dates = [
  ['scheduledOn', 'drawer.scheduled'],
  ['dueOn', 'drawer.due'],
] as const;
</script>

<template>
  <USlideover
    :open="id !== null"
    :title="$t('drawer.title')"
    :description="$t('drawer.description')"
    :ui="{ description: 'sr-only' }"
    data-testid="task-drawer"
    @update:open="(open) => !open && close()"
  >
    <template #body>
      <div v-if="task === undefined" class="flex flex-col gap-3">
        <USkeleton class="h-8 w-full" />
        <USkeleton class="h-24 w-full" />
      </div>
      <p v-else-if="task === null" role="status" class="text-sm text-muted">
        {{ $t('drawer.notFound') }}
      </p>
      <form v-else class="flex flex-col gap-4" @submit.prevent>
        <p v-if="readonly" role="status" class="text-sm text-muted">
          {{ $t('drawer.ended') }}
        </p>
        <div
          v-if="movedFrom"
          class="flex flex-wrap items-center gap-2 text-sm"
          data-testid="moved-from"
        >
          <span class="text-muted">
            {{ $t('drawer.movedFrom', { date: movedFrom }) }}
          </span>
          <UButton
            variant="outline"
            color="neutral"
            size="sm"
            :disabled="returning"
            @click="returnToSeries"
          >
            {{ $t('drawer.returnToSeries') }}
          </UButton>
        </div>
        <UFormField :label="$t('drawer.titleField')">
          <UInput
            v-model="draft.title"
            class="w-full"
            :disabled="readonly"
            @blur="saveTitle"
          />
        </UFormField>
        <UFormField :label="$t('drawer.notes')">
          <UTextarea
            v-model="draft.notes"
            class="w-full"
            :rows="4"
            :disabled="readonly"
            @blur="commit('notes', { notes: draft.notes })"
          />
        </UFormField>
        <UFormField :label="$t('drawer.project')">
          <USelectMenu
            v-model="draft.project"
            v-model:open="projectOpen"
            class="w-full"
            value-key="value"
            :items="projects"
            :disabled="readonly"
            create-item
            @update:model-value="
              commit('project', { project: draft.project || null })
            "
            @create="createProject"
          />
        </UFormField>
        <UFormField :label="$t('drawer.tags')">
          <USelectMenu
            v-model="draft.tags"
            class="w-full"
            multiple
            :items="tags"
            :disabled="readonly"
            create-item
            @update:model-value="commit('tags', { tags: [...draft.tags] })"
            @create="createTag"
          />
        </UFormField>
        <URadioGroup
          v-model="draft.priority"
          :legend="$t('drawer.priority')"
          orientation="horizontal"
          :items="priorities"
          :disabled="readonly"
          @update:model-value="commit('priority', { priority: draft.priority })"
        />
        <UFormField v-for="[key, label] in dates" :key="key" :label="$t(label)">
          <p
            v-if="key === 'scheduledOn' && recurring"
            class="text-sm"
            data-testid="rule"
          >
            {{ draft.scheduledOn }}
            <span class="text-muted">
              {{ $t('drawer.rule', { rule: task.rrule }) }}
            </span>
          </p>
          <div v-else class="flex items-center gap-2">
            <UInput
              v-model="draft[key]"
              type="date"
              :disabled="readonly"
              @change="saveDate(key)"
            />
            <UButton
              v-if="draft[key] !== ''"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              :disabled="readonly"
              :aria-label="$t('drawer.clear', { field: $t(label) })"
              @click="clearDate(key)"
            />
          </div>
        </UFormField>
        <UFormField v-if="statuses.length > 0" :label="$t('drawer.status')">
          <USelectMenu
            v-model="draft.statusId"
            class="w-full"
            value-key="value"
            :items="statuses"
            :search-input="false"
            :disabled="readonly"
            @update:model-value="saveStatus"
          />
        </UFormField>
      </form>
    </template>
  </USlideover>
</template>
