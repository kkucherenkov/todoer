<!-- Page header: references/ViewHeader.vue (one shared shell instance); layout is transient and preserves query/task. -->
<script setup lang="ts">
// Nuxt UI 4 reference: port the styling into existing components, not this
// file wholesale. Existing app composables own writes, outbox and Undo.
import { computed, onScopeDispose, ref, watch } from "vue";
import type { DropdownMenuItem } from "@nuxt/ui";

type ListItem = {
  id: string;
  title: string;
  project?: string | null;
  tags: string[];
  priority: number;
  occurrence?: string | null;
  dueOn?: string | null;
  status?: string | null;
  parentId?: string | null;
  parentTitle?: string | null;
};
const props = defineProps<{ view: string; sort: string; items: ListItem[] }>();
const db = useDb();
const sync = useTopic("sync");
const route = useRoute();
const router = useRouter();
const { t, locale, locales, setLocale } = useI18n();
const summary = useTopic("summary");
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 10_000);
onScopeDispose(() => clearInterval(clock));
const taskCount = computed(() => {
  const n = summary.value?.tasks ?? 0;
  return t(`summary.tasks.${pluralForm(locale.value, n)}`, { n });
});
const lastSynced = computed(() => {
  const at = sync.value?.lastSyncedAt;
  if (!at) return t("summary.neverSynced");
  const seconds = Math.min(0, Math.round((Date.parse(at) - now.value) / 1000));
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds > -60
      ? [seconds, "second"]
      : seconds > -3600
        ? [Math.round(seconds / 60), "minute"]
        : [Math.round(seconds / 3600), "hour"];
  return t("summary.lastSynced", {
    when: new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" }).format(
      value,
      unit,
    ),
  });
});
const marked = useMarked();
const fail = useFail();
const manual = computed(() => props.sort === "manual");
const ids = computed(() => props.items.map((item) => String(item.id)));
const container = ref<HTMLElement | null>(null);
const text = ref("");
const error = ref<string | null>(null);
watch(text, () => {
  error.value = null;
});
// Preserve the app's idempotent quick-add retry contract.
let attempt: { text: string; write: ReturnType<typeof db.mint> } | null = null;
async function add() {
  const value = text.value.trim();
  if (!value) return;
  if (attempt?.text !== value)
    attempt = { text: value, write: db.mint({ kind: "add", text: value }) };
  const result = await db.write(attempt.write);
  if (result.ok) {
    attempt = null;
    error.value = null;
    text.value = "";
    return;
  }
  const { kind, detail } = result.failure;
  error.value =
    kind === "invalid"
      ? `${t("errors.invalid")} ${detail}`
      : t(`errors.${kind}`);
}
async function mark(item: ListItem, mark: "done" | "skip") {
  const taskId = String(item.id);
  const result = await db.write({ kind: "mark", taskId, mark });
  if (!result.ok) return fail(result);
  marked(taskId, item.title, mark, result.note);
}
async function move(taskId: string, after: string | null) {
  const result = await db.write({
    kind: "move",
    taskId,
    view: props.view,
    after,
  });
  if (!result.ok) fail(result);
}
const drag = useDrag(container, move, () => manual.value);
const open = (id: string) =>
  router.push({ query: { ...route.query, task: id } });
const priorityColor = (p: number): "error" | "warning" | "info" | "neutral" =>
  p === 0 ? "error" : p === 1 ? "warning" : p === 2 ? "info" : "neutral";
function actions(item: ListItem, index: number): DropdownMenuItem[] {
  return [
    {
      label: t("list.skip"),
      icon: "i-lucide-skip-forward",
      onSelect: () => mark(item, "skip"),
    },
    ...(manual.value
      ? [
          {
            label: t("list.moveUp"),
            icon: "i-lucide-arrow-up",
            disabled: index === 0,
            onSelect: () => move(String(item.id), ids.value[index - 2] ?? null),
          },
          {
            label: t("list.moveDown"),
            icon: "i-lucide-arrow-down",
            disabled: index === props.items.length - 1,
            onSelect: () => move(String(item.id), ids.value[index + 1]!),
          },
        ]
      : []),
    {
      label: t("list.open"),
      icon: "i-lucide-panel-right-open",
      onSelect: () => open(String(item.id)),
    },
  ];
}
</script>

<template>
  <UDashboardGroup data-od-id="list-shell">
    <UDashboardSidebar collapsible data-od-id="list-sidebar">
      <template #header>
        <h1
          class="text-lg font-semibold text-highlighted"
          data-od-id="app-name"
        >
          {{ $t("app.title") }}
        </h1>
      </template>
      <!-- Existing ViewNav preserves catalog links, literal Lucide icons,
           Views landmark and New view modal. No new destinations. -->
      <ViewNav />
      <template #footer>
        <div class="flex w-full flex-col gap-3">
          <section
            class="flex w-full flex-col gap-2 tabular-nums"
            data-od-id="sync-summary"
          >
            <p
              class="text-sm font-medium text-highlighted"
              data-testid="task-count"
            >
              {{ taskCount }}
            </p>
            <p class="text-xs text-muted" data-testid="last-synced">
              {{ lastSynced }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-if="sync?.reached === false"
                color="warning"
                variant="solid"
                data-testid="offline"
                >{{ $t("summary.offline") }}</UBadge
              >
              <UBadge
                v-if="sync?.pending"
                color="neutral"
                variant="subtle"
                data-testid="pending"
                >{{ $t("summary.pending", { n: sync.pending }) }}</UBadge
              >
              <UBadge
                v-if="sync?.failed && sync.reached !== false && !sync.problem"
                color="error"
                variant="subtle"
                data-testid="failed"
                >{{ $t("summary.failed", { n: sync.failed }) }}</UBadge
              >
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="outline"
                size="md"
                :loading="sync?.running"
                data-testid="sync-now"
                data-od-id="sync-now"
                @click="db.request({ kind: 'sync', reason: 'manual' })"
                >{{ $t("summary.syncNow") }}</UButton
              >
              <UButton
                color="neutral"
                variant="outline"
                size="md"
                data-testid="sign-out"
                data-od-id="sign-out"
                @click="db.request({ kind: 'signOut' })"
                >{{ $t("summary.signOut") }}</UButton
              >
            </div>
          </section>
          <div class="flex flex-wrap gap-2" data-od-id="locale-switch">
            <UButton
              v-for="language in locales"
              :key="language.code"
              color="neutral"
              size="sm"
              :variant="language.code === locale ? 'solid' : 'outline'"
              :data-od-id="`locale-${language.code}`"
              @click="setLocale(language.code)"
              >{{ language.name }}</UButton
            >
          </div>
        </div>
      </template>
    </UDashboardSidebar>
    <UDashboardPanel data-testid="view" data-od-id="list-panel">
      <template #header>
        <UDashboardNavbar :title="$t('nav.all')" data-od-id="list-navbar">
          <template #leading
            ><UDashboardSidebarToggle :aria-label="$t('nav.title')"
          /></template>
        </UDashboardNavbar>
        <UpdatePrompt class="m-4 mb-0" />
        <UAlert
          v-if="sync?.problem && sync.reached !== false"
          color="error"
          variant="subtle"
          class="m-4 mb-0"
          data-testid="sync-problem"
          data-od-id="sync-refused"
          :title="$t('errors.syncProblem')"
          :description="sync.problem"
          :actions="[
            {
              label: t('summary.syncNow'),
              color: 'error',
              variant: 'outline',
              onClick: () => db.request({ kind: 'sync', reason: 'manual' }),
            },
          ]"
        />
      </template>
      <template #body>
        <div
          class="mx-auto flex w-full max-w-3xl flex-col gap-4"
          data-od-id="list-body"
        >
          <div class="flex flex-col gap-1" data-od-id="quick-add">
            <UInput
              v-model="text"
              size="lg"
              icon="i-lucide-plus"
              class="w-full"
              :placeholder="$t('list.quickAddPlaceholder')"
              :aria-label="$t('list.quickAdd')"
              data-od-id="quick-add-input"
              @keydown.enter.prevent="add"
            />
            <p
              v-if="error"
              role="alert"
              class="text-sm text-error"
              data-od-id="quick-add-error"
            >
              {{ error }}
            </p>
          </div>
          <p
            v-if="items.length === 0"
            class="text-sm text-muted"
            data-od-id="empty-list"
          >
            {{ $t("list.empty") }}
          </p>
          <div
            v-else
            ref="container"
            class="divide-y divide-default"
            data-testid="task-list"
            data-od-id="task-list"
            v-bind="drag.containerEvents"
          >
            <div
              v-for="(item, index) in items"
              :key="String(item.id)"
              class="flex items-start gap-3 px-2 py-1.5 hover:bg-muted"
              :class="
                drag.line.value === String(item.id) &&
                'border-t-2 !border-t-primary'
              "
              data-testid="task-row"
              :data-task-id="String(item.id)"
              :data-od-id="`task-${item.id}`"
              v-bind="drag.rowEvents(String(item.id))"
            >
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-lucide-check"
                class="shrink-0 rounded-full"
                :aria-label="$t('list.markDone')"
                :data-od-id="`mark-done-${item.id}`"
                @click="mark(item, 'done')"
              />
              <div
                class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1"
              >
                <button
                  type="button"
                  class="max-w-full rounded-sm text-left text-sm leading-5 font-medium text-highlighted break-words whitespace-normal focus-visible:outline-2 focus-visible:outline-primary"
                  data-testid="task-title"
                  :data-od-id="`title-${item.id}`"
                  @click="open(String(item.id))"
                >
                  {{ item.title }}
                </button>
                <UButton
                  v-if="item.parentTitle"
                  color="neutral"
                  variant="link"
                  size="xs"
                  icon="i-lucide-corner-down-right"
                  class="p-0 text-muted hover:text-highlighted whitespace-normal"
                  data-testid="parent-link"
                  :aria-label="
                    $t('list.openParent', { title: item.parentTitle })
                  "
                  :data-od-id="`parent-${item.id}`"
                  @click.stop="open(String(item.parentId))"
                  >{{ item.parentTitle }}</UButton
                >
                <span v-if="item.project" class="text-sm text-muted break-words"
                  >#{{ item.project }}</span
                >
                <span
                  v-for="tag in item.tags"
                  :key="tag"
                  class="text-sm text-muted break-words"
                  >{{ tag }}</span
                >
                <UBadge
                  v-if="Number.isInteger(Number(item.priority))"
                  :color="priorityColor(Number(item.priority))"
                  variant="subtle"
                  size="sm"
                  >p{{ item.priority }}</UBadge
                >
                <span
                  v-if="item.occurrence"
                  class="inline-flex items-center gap-1 text-sm text-muted tabular-nums"
                  data-testid="occurrence"
                >
                  <UIcon name="i-lucide-repeat" class="size-4" /><time
                    :datetime="item.occurrence"
                    >{{ item.occurrence }}</time
                  >
                </span>
                <span
                  v-if="item.dueOn"
                  class="text-sm text-muted tabular-nums"
                  >{{ $t("list.due", { date: item.dueOn }) }}</span
                >
                <UBadge
                  v-if="item.status"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  >{{ item.status }}</UBadge
                >
              </div>
              <UDropdownMenu :items="actions(item, index)">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-ellipsis"
                  :aria-label="$t('list.actions')"
                  :data-od-id="`actions-${item.id}`"
                />
              </UDropdownMenu>
            </div>
            <div
              v-if="drag.line.value === ''"
              class="h-0 border-t-2 border-primary"
              data-od-id="end-drop-indicator"
            />
          </div>
        </div>
      </template>
    </UDashboardPanel>
    <!-- The existing drawer keeps ?task=, saves-on-blur, Escape and focus
         trapping. useMarked above keeps Done / recurring Done / Skipped,
         task-title description and the original inverse write for Undo. -->
    <TaskDrawer />
  </UDashboardGroup>
</template>
