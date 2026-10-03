<!-- Mount once in the shared shell above List / Kanban / Calendar bodies. -->
<script setup lang="ts">
import ViewModeTabs from './ViewModeTabs.vue';
const layout = defineModel<'list' | 'kanban' | 'calendar'>('layout', { required: true });
defineProps<{ title: string; count?: string }>();
</script>
<template>
  <header class="view-header" data-od-id="shared-page-header">
    <h1 data-od-id="page-title">{{ title }}</h1>
    <ViewModeTabs v-model:layout="layout" />
    <p v-if="count" class="view-count">{{ count }}</p>
  </header>
</template>
<style scoped>
.view-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px 16px}
h1{margin:0;overflow-wrap:anywhere;color:var(--ui-text-highlighted);font-size:var(--text-2xl)}
.view-count{grid-column:1 / -1;margin:0;color:var(--ui-text-toned)}
</style>
