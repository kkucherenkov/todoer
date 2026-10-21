<script setup lang="ts">
// The watched view, drawn by its layout.
const view = useTopic('view');
const route = useRoute();
const layout = computed(
  () => resolveLayout(route.query.layout, view.value?.layout).layout,
);
</script>

<template>
  <div
    id="view-content"
    role="tabpanel"
    :aria-labelledby="`mode-${layout}`"
    class="flex flex-col gap-3"
    data-testid="view"
  >
    <UAlert
      v-if="view?.problem"
      color="warning"
      variant="subtle"
      :title="$t('view.problem')"
      :description="
        view.problem === 'deleted' ? $t('view.deleted') : view.problem
      "
    />
    <TaskList
      v-else-if="view && layout === 'list'"
      :view="view.key"
      :sort="view.sort"
      :items="view.items"
    />
    <KanbanBoard
      v-else-if="view && layout === 'kanban'"
      :view="view.key"
      :sort="view.sort"
      :items="view.items"
    />
    <CalendarView
      v-else-if="view && layout === 'calendar'"
      :today="view.today"
      :span="view.span"
      :items="view.items"
      :placements="view.placements"
    />
  </div>
</template>
