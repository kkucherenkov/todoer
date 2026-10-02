<script setup lang="ts">
// The watched view, drawn by its layout.
const view = useTopic('view');
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="view">
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
      v-else-if="view?.layout === 'list'"
      :view="view.key"
      :sort="view.sort"
      :items="view.items"
    />
    <KanbanBoard
      v-else-if="view?.layout === 'kanban'"
      :view="view.key"
      :sort="view.sort"
      :items="view.items"
    />
    <CalendarView
      v-else-if="view?.layout === 'calendar'"
      :today="view.today"
      :span="view.span"
      :items="view.items"
      :placements="view.placements"
    />
  </div>
</template>
