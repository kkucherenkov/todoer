<script setup lang="ts">
const { locale, locales, setLocale } = useI18n();
</script>

<template>
  <div class="flex gap-2">
    <UButton
      v-for="l in locales"
      :key="l.code"
      size="sm"
      :variant="l.code === locale ? 'solid' : 'outline'"
      @click="setLocale(l.code)"
    >
      {{ l.name }}
    </UButton>
  </div>
</template>
