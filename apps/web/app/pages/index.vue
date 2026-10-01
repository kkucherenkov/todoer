<script setup lang="ts">
const { locale, locales, setLocale } = useI18n();
</script>

<template>
  <main class="p-6">
    <h1 class="text-2xl font-semibold">{{ $t('app.title') }}</h1>
    <div class="mt-4 flex gap-2">
      <UButton
        v-for="l in locales"
        :key="l.code"
        :variant="l.code === locale ? 'solid' : 'outline'"
        @click="setLocale(l.code)"
      >
        {{ l.name }}
      </UButton>
    </div>
  </main>
</template>
