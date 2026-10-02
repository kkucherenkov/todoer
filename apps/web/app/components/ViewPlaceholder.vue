<script setup lang="ts">
// Until Tasks 8 and 10 draw the layouts: what the watched view resolved to.
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
    <p v-else-if="view" class="text-sm">
      {{ $t('view.soon') }}
    </p>
  </div>
</template>
