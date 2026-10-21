<script setup lang="ts">
import * as uiLocales from '@nuxt/ui/locale';

const { locale } = useI18n();
const uiLocale = computed(() => uiLocales[locale.value]);
// The document language follows the switch: screen readers pick the voice
// from it, and the static index.html carries none.
useHead({ htmlAttrs: { lang: locale } });
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
