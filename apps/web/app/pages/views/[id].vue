<script setup lang="ts">
const route = useRoute();
useWatch(() => String(route.params.id));
</script>

<template>
  <ViewBody />
</template>
