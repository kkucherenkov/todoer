<script setup lang="ts">
const { locale, setLocale } = useI18n();
const english = computed(() => locale.value === 'en');
</script>

<template>
  <div class="flex items-center gap-2">
    <span :class="!english ? 'font-semibold text-primary' : 'text-muted'">RU</span>
    <USwitch
      :model-value="english"
      :aria-label="english ? 'Interface language: English; switch to Russian' : 'Язык интерфейса: русский; переключить на английский'"
      @update:model-value="setLocale($event ? 'en' : 'ru')"
    />
    <span :class="english ? 'font-semibold text-primary' : 'text-muted'">EN</span>
  </div>
</template>
