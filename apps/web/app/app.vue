<script setup lang="ts">
import * as uiLocales from '@nuxt/ui/locale';

const { locale } = useI18n();
const uiLocale = computed(() => uiLocales[locale.value as 'en' | 'ru']);
</script>

<template>
  <UApp :locale="uiLocale"><NuxtPage /></UApp>
</template>
