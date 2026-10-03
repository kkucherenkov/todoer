<!-- Read-only source contract reference; not installed in the application. -->
<script setup lang="ts">
import type { FormError } from '@nuxt/ui';
import type { Db } from '~/db/client';
import type { Failure } from '@todoer/client-core';

// Shown only while the instance has no users: this account becomes the owner.
const { db } = defineProps<{ db: Db }>();
const { t } = useI18n();
const form = reactive({ email: '', password: '', confirm: '' });
const pending = ref(false);
const failure = ref<Failure | null>(null);

// The strength rule is the server's (shown as the help line, refused with
// its reason); only the confirmation is checked here, before anything is
// sent. On submit only: validating on blur inserts the message between the
// button's mousedown and mouseup, the button moves, and the click is lost.
const validate = (state: typeof form): FormError[] =>
  state.confirm !== '' && state.confirm !== state.password
    ? [{ name: 'confirm', message: t('register.mismatch') }]
    : [];

async function submit() {
  pending.value = true;
  failure.value = null;
  const { email, password } = form;
  const result = await db.request({ kind: 'register', email, password });
  pending.value = false;
  if (!result.ok) failure.value = result.failure;
}
</script>

<template>
  <UForm
    :state="form"
    :validate="validate"
    :validate-on="[]"
    class="flex max-w-sm flex-col gap-4"
    data-testid="register-form"
    @submit="submit"
  >
    <h2 class="text-xl font-semibold">{{ $t('register.title') }}</h2>
    <p class="text-sm text-muted">{{ $t('register.intro') }}</p>
    <UAlert
      v-if="failure"
      color="error"
      variant="subtle"
      data-testid="register-error"
      :title="$t(`errors.${failure.kind}`)"
      :description="failure.detail"
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
    <UFormField
      :label="$t('signIn.password')"
      name="password"
      :help="$t('register.rule')"
    >
      <UInput
        v-model="form.password"
        type="password"
        autocomplete="new-password"
        required
        minlength="8"
        class="w-full"
        data-testid="password"
      />
    </UFormField>
    <UFormField :label="$t('register.confirm')" name="confirm">
      <UInput
        v-model="form.confirm"
        type="password"
        autocomplete="new-password"
        required
        class="w-full"
        data-testid="confirm"
      />
    </UFormField>
    <UButton
      type="submit"
      :loading="pending"
      :disabled="pending"
      data-testid="register"
    >
      {{ $t('register.submit') }}
    </UButton>
  </UForm>
</template>
