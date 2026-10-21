<script setup lang="ts">
import * as uiLocales from '@nuxt/ui/locale';

const { locale } = useI18n();
const uiLocale = computed(() => uiLocales[locale.value]);
</script>

<template>
  <UApp :locale="uiLocale">
    <AppGate>
      <AppShell>
        <NuxtPage />
      </AppShell>
    </AppGate>
  </UApp>
</template>
