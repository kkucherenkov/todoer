<script setup lang="ts">
import { ALL, type TaskChanges } from '@todoer/client-core';
import type { Draft as WriteDraft } from '~/db/client';
import { createIntent } from '~/utils/intent';

const db = useDb();
const open = useOpenTask();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const fail = useFail();
const { t } = useI18n();
const topic = useTopic('task');
const catalog = useTopic('catalog');
const sync = useTopic('sync');

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
// Scheduled by a rule: its own, or a subtask's parent's (ADR 0009).
const ruled = computed(
  () => recurring.value || (task.value?.occurrence ?? null) !== null,
);
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
    // A task scheduled by a rule shows its current occurrence.
    scheduledOn: ruled.value
      ? (k.occurrence ?? '')
      : typeof k.scheduledOn === 'string'
        ? k.scheduledOn
        : '',
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
  priority: 4,
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
      json !== undefined &&
      Object.assign(draft, { [key]: JSON.parse(json) as Draft[typeof key] }),
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

// Deleted elsewhere while open: close, and say so. Our own delete and
// return-to-series close it themselves.
const returning = ref(false);
const deleting = ref(false);
watch(task, (now, before) => {
  if (now !== null || !before || returning.value || deleting.value) return;
  toast.add({ title: t('drawer.gone') });
  void close();
});

const undoMove = createIntent(db);
/** The copy is deleted and its occurrence reopened, so the drawer has
 *  nothing left to show; a refusal stays here with its reason. */
async function returnToSeries() {
  if (id.value === null) return;
  returning.value = true;
  const result = await undoMove({ kind: 'undoMove', taskId: id.value });
  returning.value = false;
  if (result.ok) void close();
  else fail(result);
}

const confirmingDelete = ref(false);
const deleteError = ref<string | null>(null);
const editingRule = ref(false);
const more = useState('drawer-more', () => false);
const del = createIntent(db);

const reasonOf = ({ failure }: { failure: { kind: string; detail: string } }) =>
  [t(`errors.${failure.kind}`), failure.detail].filter(Boolean).join(' ');

/** The task and its live subtasks go in one batch, with no undo. A refusal
 *  (not synced yet) keeps the dialog open with its reason; confirming again
 *  resends the same write. */
async function deleteTask() {
  if (id.value === null || deleting.value) return;
  deleting.value = true;
  const result = await del({ kind: 'deleteTask', taskId: id.value });
  deleting.value = false;
  if (!result.ok) return void (deleteError.value = reasonOf(result));
  confirmingDelete.value = false;
  toast.add({ title: t('deleteTask.done') });
  void close();
}
function closeDelete() {
  confirmingDelete.value = false;
  deleteError.value = null;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// What the status line says: a write in flight, then saved on this device.
const saving = ref(0);
const saved = ref(false);
/** The last refused field write: the field shows the saved value again,
 *  this keeps the person's one, and Retry resends the same write. */
const refused = ref<{
  key: keyof Draft;
  write: WriteDraft;
  saved: string;
  wanted: string;
  reason: string;
} | null>(null);
watch(id, () => {
  saved.value = false;
  refused.value = null;
});
// A refused write that had in fact landed (a late answer) needs no retry.
watch(server, (now) => {
  const r = refused.value;
  if (r && now && shown(r.key, now[r.key]) === r.wanted) refused.value = null;
});
// One held write per field, so a refusal of one survives another's save.
const intents = new Map<keyof Draft, ReturnType<typeof createIntent>>();
const intentOf = (key: keyof Draft) =>
  intents.get(key) ?? intents.set(key, createIntent(db)).get(key)!;

function shown(key: keyof Draft, value: unknown): string {
  if (key === 'project') return String(value) || t('drawer.noProject');
  if (key === 'priority') return `p${String(value)}`;
  if (key === 'tags') return (value as string[]).join(' ');
  if (key === 'scheduledOn' || key === 'dueOn')
    return String(value) || t('drawer.noDate');
  if (key === 'statusId')
    return statuses.value.find((s) => s.value === value)?.label ?? '';
  return String(value);
}

async function send(key: keyof Draft, write: WriteDraft, wanted: string) {
  const from = server.value;
  if (!from) return null;
  saving.value++;
  const result = await intentOf(key)(write);
  saving.value--;
  if (result.ok) {
    saved.value = true;
    if (refused.value?.key === key) refused.value = null;
    return result;
  }
  refused.value = {
    key,
    write,
    saved: shown(key, from[key]),
    wanted,
    reason: reasonOf(result),
  };
  Object.assign(draft, { [key]: structuredClone(toRaw(from[key])) });
  return result;
}

const retry = () => {
  const r = refused.value;
  if (r) void send(r.key, r.write, r.wanted);
};

/** One field, one `edit` with one change. */
async function commit(key: keyof Draft, changes: TaskChanges) {
  const from = server.value;
  if (!from || id.value === null || same(draft[key], from[key])) return;
  await send(
    key,
    { kind: 'edit', taskId: id.value, changes },
    shown(key, draft[key]),
  );
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
  const result = await send(
    'statusId',
    { kind: 'move', taskId: id.value, view: ALL, statusId: draft.statusId },
    shown('statusId', draft.statusId),
  );
  if (result?.ok && result.note?.occurrence && result.note.next) {
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
    :ui="{ description: 'sr-only', close: 'size-11' }"
    data-testid="task-drawer"
    @update:open="(open) => !open && close()"
    @after:leave="restoreDrawerFocus()"
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
        <p role="status" class="text-sm text-muted" data-testid="save-status">
          <template v-if="saving > 0">{{ $t('drawer.saving') }}</template>
          <template v-else>
            <template v-if="saved">
              {{ $t('drawer.saved') }}
              <template v-if="sync?.pending">
                · {{ $t('drawer.waiting', { n: sync.pending }) }}
              </template>
              ·
            </template>
            {{ $t('drawer.blurHint') }}
          </template>
        </p>
        <div
          v-if="refused"
          role="alert"
          class="flex flex-col gap-1 rounded-md border border-error/40 bg-error/10 p-3 text-sm"
          data-testid="refused"
        >
          <p>{{ $t('drawer.savedValue', { value: refused.saved }) }}</p>
          <p>{{ $t('drawer.yourChange', { value: refused.wanted }) }}</p>
          <p class="text-muted">{{ refused.reason }}</p>
          <UButton
            variant="outline"
            color="neutral"
            size="sm"
            class="self-start"
            :loading="saving > 0"
            @click="retry"
          >
            {{ $t('drawer.retry') }}
          </UButton>
        </div>
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
        <UButton
          v-if="task.parentId && task.parentTitle"
          variant="link"
          color="neutral"
          icon="i-lucide-corner-up-left"
          class="self-start p-0"
          data-testid="subtask-of"
          @click="open(String(task.parentId))"
        >
          {{ $t('drawer.subtaskOf', { title: task.parentTitle }) }}
        </UButton>
        <UFormField :label="$t('drawer.titleField')">
          <UInput
            v-model="draft.title"
            class="w-full"
            size="lg"
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
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            v-for="[key, label] in dates"
            :key="key"
            :label="$t(label)"
          >
            <p
              v-if="key === 'scheduledOn' && ruled"
              class="text-sm"
              data-testid="rule"
            >
              {{ draft.scheduledOn }}
              <span class="text-muted">
                {{
                  task.rrule
                    ? $t('drawer.rule', { rule: task.rrule })
                    : $t('drawer.ruleParent')
                }}
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
        </div>
        <details
          :open="more"
          class="group rounded-md border border-default"
          @toggle="more = ($event.target as HTMLDetailsElement).open"
        >
          <summary
            class="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium"
          >
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 transition-transform group-open:rotate-90"
            />
            {{ $t('drawer.more') }}
          </summary>
          <div class="flex flex-col gap-4 px-3 pb-3">
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
              @update:model-value="
                commit('priority', { priority: draft.priority })
              "
            />
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
            <div v-if="movedFrom === null" class="flex flex-col gap-1">
              <UButton
                variant="outline"
                color="neutral"
                size="sm"
                icon="i-lucide-repeat"
                class="self-start"
                :disabled="!!task.parentId"
                :aria-describedby="task.parentId ? 'child-rule' : undefined"
                @click="editingRule = true"
              >
                {{ recurring ? $t('drawer.editRepeat') : $t('drawer.repeat') }}
              </UButton>
              <p
                v-if="task.parentId"
                id="child-rule"
                class="text-sm text-muted"
              >
                {{ $t('drawer.childRule') }}
              </p>
            </div>
          </div>
        </details>
        <SubtaskList v-if="!task.parentId" :task="task" :readonly="readonly" />
        <UButton
          color="error"
          variant="outline"
          icon="i-lucide-trash-2"
          class="self-start"
          data-testid="delete-task"
          @click="confirmingDelete = true"
        >
          {{ $t('deleteTask.delete') }}
        </UButton>
      </form>
    </template>
  </USlideover>
  <RecurrenceDialog
    v-if="task"
    :open="editingRule"
    :task="task"
    @close="editingRule = false"
  />
  <DeleteTaskDialog
    :open="confirmingDelete"
    :title="String(task?.title ?? '')"
    :subtasks="task?.subtasks.length ?? 0"
    :pending="deleting"
    :error="deleteError"
    @confirm="deleteTask"
    @close="closeDelete"
  />
</template>
