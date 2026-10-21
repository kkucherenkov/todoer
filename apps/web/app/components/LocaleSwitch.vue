<script setup lang="ts">
const { locale, setLocale } = useI18n();
const english = computed(() => locale.value === 'en');
</script>

<template>
  <div class="locale-switch">
    <span :class="!english ? 'font-semibold text-primary' : 'text-muted'">
      RU
    </span>
    <USwitch
      :model-value="english"
      :aria-label="
        english ? $t('locale.switchToRussian') : $t('locale.switchToEnglish')
      "
      @update:model-value="setLocale($event ? 'en' : 'ru')"
    />
    <span :class="english ? 'font-semibold text-primary' : 'text-muted'">
      EN
    </span>
  </div>
</template>
