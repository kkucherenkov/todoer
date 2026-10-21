<script setup lang="ts">
import * as uiLocales from '@nuxt/ui/locale';

const { locale, t } = useI18n();
const uiLocale = computed(() => uiLocales[locale.value]);
// The static index.html has neither a language nor a title. The language
// follows the switch: screen readers pick the voice from it.
useHead({ htmlAttrs: { lang: locale }, title: () => t('app.title') });
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
