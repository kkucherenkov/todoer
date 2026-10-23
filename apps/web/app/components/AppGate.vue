<script setup lang="ts">
// The one place that decides what the page may show: nothing of the account
// reaches the slot unless the session is signed in.
const { $db: db } = useNuxtApp();
const engine = computed(() => db?.topics.engine.value);
const session = computed(() => db?.topics.session.value);
const reload = () => location.reload();

// Asked again on every sign-out: an owner who registered and signed out
// must get the sign-in form back. null while asking.
const open = ref<boolean | null>(null);
watch(
  () => session.value?.state === 'signed-out',
  async (out) => {
    if (!out) return;
    open.value = null;
    open.value = await registrationOpen();
  },
  { immediate: true },
);
</script>

<template>
  <slot
    v-if="db && engine?.state === 'ready' && session?.state === 'signed-in'"
  />
  <!-- screens.css .gate-wrap: 384px, 64px down (32px at 700px and less). -->
  <main
    v-else
    class="mx-auto my-16 flex w-full max-w-sm flex-col gap-6 px-4 max-[700px]:my-8"
  >
    <header class="mb-2 flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t('app.title') }}</h1>
      <LocaleSwitch />
    </header>
    <!-- Signed out, the workspace alerts are not drawn: the prompt is here. -->
    <UpdatePrompt />

    <UAlert
      v-if="!db"
      color="warning"
      variant="subtle"
      data-testid="insecure"
      :title="$t('insecure.title')"
      :description="$t('insecure.body')"
    />
    <!-- Before the first stream: the server is not answering (client.ts). -->
    <UAlert
      v-else-if="
        engine?.state === 'starting' && engine.reason === 'unreachable'
      "
      color="warning"
      variant="subtle"
      data-testid="unreachable"
      :title="$t('errors.unreachable')"
      :actions="[{ label: $t('failed.reload'), onClick: reload }]"
    />
    <div
      v-else-if="
        engine?.state === 'starting' ||
        !session ||
        session.state === 'restoring' ||
        open === null
      "
      class="flex max-w-sm flex-col gap-3"
      data-testid="loading"
    >
      <USkeleton class="h-8 w-40" />
      <USkeleton class="h-4 w-56" />
    </div>
    <RegisterForm v-else-if="open" :db="db" />
    <SignInForm v-else :db="db" />
  </main>
</template>
