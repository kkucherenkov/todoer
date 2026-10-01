<script setup lang="ts">
import type { Db } from '~/db/client';
import type { Failure } from '~/db/protocol';

const { db } = defineProps<{ db: Db }>();
const form = reactive({ email: '', password: '' });
const pending = ref(false);
const failure = ref<Failure | null>(null);
// A signed-out session can carry its own reason (a foreign outbox at start).
const kind = computed(
  () => failure.value?.kind ?? db.topics.session.value?.reason ?? null,
);

async function submit() {
  pending.value = true;
  failure.value = null;
  const result = await db.request({ kind: 'signIn', ...form });
  pending.value = false;
  if (!result.ok) failure.value = result.failure;
  else form.password = '';
}
</script>

<template>
  <UForm :state="form" class="flex max-w-sm flex-col gap-4" @submit="submit">
    <h2 class="text-xl font-semibold">{{ $t('signIn.title') }}</h2>
    <UAlert
      v-if="kind"
      color="error"
      variant="subtle"
      data-testid="sign-in-error"
      :title="$t(`errors.${kind}`)"
      :description="failure?.detail"
    />
    <UFormField :label="$t('signIn.email')" name="email">
      <UInput
        v-model="form.email"
        type="email"
        autocomplete="username"
        required
        class="w-full"
        data-testid="email"
      />
    </UFormField>
    <UFormField :label="$t('signIn.password')" name="password">
      <UInput
        v-model="form.password"
        type="password"
        autocomplete="current-password"
        required
        class="w-full"
        data-testid="password"
      />
    </UFormField>
    <UButton
      type="submit"
      :loading="pending"
      :disabled="pending"
      data-testid="sign-in"
    >
      {{ $t('signIn.submit') }}
    </UButton>
  </UForm>
</template>
