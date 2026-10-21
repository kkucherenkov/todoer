<script setup lang="ts">
import { TODAY } from '@todoer/client-core';

useWatch(() => TODAY);
</script>

<template>
  <ViewBody />
</template>
