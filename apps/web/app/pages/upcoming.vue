<script setup lang="ts">
import { UPCOMING } from '@todoer/client-core';

useWatch(() => UPCOMING);
</script>

<template>
  <ViewBody />
</template>
