<script setup lang="ts">
import * as uiLocales from '@nuxt/ui/locale';

const { locale } = useI18n();
const uiLocale = computed(() => uiLocales[locale.value]);
</script>

<template>
  <UApp :locale="uiLocale">
    <UpdatePrompt class="m-6 mb-0" />
    <AppGate>
      <AppShell>
        <NuxtPage />
      </AppShell>
    </AppGate>
  </UApp>
</template>
