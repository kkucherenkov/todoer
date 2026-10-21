<script setup lang="ts">
import { PROJECT_PREFIX } from '@todoer/client-core';

const route = useRoute();
// An unknown or deleted project is published as `deleted` (ViewBody says so).
useWatch(() => `${PROJECT_PREFIX}${String(route.params.id)}`);
</script>

<template>
  <ViewBody />
</template>
