<script setup lang="ts">
import type { Write } from '~/db/protocol';

const db = useDb();
const { t } = useI18n();
const text = ref('');
const error = ref<string | null>(null);
watch(text, () => (error.value = null));
// The minted write survives a failed attempt: a retry of the same text is
// the same operation (a slow first attempt may already have applied).
let attempt: { text: string; write: Write } | null = null;

async function add() {
  const value = text.value.trim();
  if (value === '') return;
  if (attempt?.text !== value) {
    attempt = { text: value, write: db.mint({ kind: 'add', text: value }) };
  }
  const result = await db.write(attempt.write);
  if (result.ok) {
    attempt = null;
    error.value = null;
    text.value = '';
    return;
  }
  const { kind, detail } = result.failure;
  error.value =
    kind === 'invalid'
      ? `${t('errors.invalid')} ${detail}`
      : t(`errors.${kind}`);
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <UInput
      v-model="text"
      :placeholder="$t('list.quickAddPlaceholder')"
      :aria-label="$t('list.quickAdd')"
      icon="i-lucide-plus"
      size="lg"
      @keydown.enter.prevent="add"
    />
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
