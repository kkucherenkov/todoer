<script setup lang="ts">
import { TAG_PREFIX } from '@todoer/client-core';

const route = useRoute();
// An unknown or deleted tag is published as `deleted` (ViewBody says so).
useWatch(() => `${TAG_PREFIX}${String(route.params.id)}`);
</script>

<template>
  <ViewBody />
</template>
