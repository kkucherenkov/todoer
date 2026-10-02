<script setup lang="ts">
// The one place that decides what the page may show: nothing of the replica
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
  <main v-else class="flex flex-col gap-6 p-6">
    <header class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t('app.title') }}</h1>
      <LocaleSwitch />
    </header>

    <UAlert
      v-if="!db"
      color="warning"
      variant="subtle"
      data-testid="insecure"
      :title="$t('insecure.title')"
      :description="$t('insecure.body')"
    />
    <UAlert
      v-else-if="engine?.state === 'failed'"
      color="error"
      variant="subtle"
      data-testid="engine-failed"
      :title="$t('failed.title')"
      :description="engine.reason ?? undefined"
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
