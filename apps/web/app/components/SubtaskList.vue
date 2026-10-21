<script setup lang="ts">
import type { TaskDetails, Write } from '@todoer/client-core';

const props = defineProps<{ task: TaskDetails; readonly: boolean }>();
const db = useDb();
const fail = useFail();
const open = useOpenTask();
const folded = useFolded();

const done = computed(() => props.task.subtasks.filter((s) => s.closed).length);
const text = ref('');
// The minted write survives a failed attempt: a retry of the same text is
// the same operation.
let attempt: { text: string; write: Write } | null = null;

async function add() {
  const value = text.value.trim();
  if (value === '') return;
  if (attempt?.text !== value) {
    attempt = {
      text: value,
      write: db.mint({
        kind: 'add',
        text: value,
        parentId: String(props.task.id),
      }),
    };
  }
  const result = await db.write(attempt.write);
  if (!result.ok) return fail(result);
  attempt = null;
  text.value = '';
  // A new child is visible at once, as UX.md asks, even under a fold.
  folded.unfold(String(props.task.id));
}

const tick = useTick();
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="subtasks">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-medium">{{ $t('drawer.subtasksTitle') }}</h3>
      <span
        v-if="task.subtasks.length > 0"
        class="text-sm text-muted"
        data-testid="progress"
      >
        {{ $t('drawer.progress', { done, total: task.subtasks.length }) }}
      </span>
    </div>
    <ul class="flex flex-col gap-1">
      <li
        v-for="s in task.subtasks"
        :key="s.id"
        class="flex items-center gap-2"
        data-testid="subtask"
      >
        <UCheckbox
          :model-value="s.closed"
          :disabled="readonly"
          :aria-label="$t('drawer.doneLabel', { title: s.title })"
          @update:model-value="tick(task, s.id, $event === true)"
        />
        <UButton
          variant="link"
          color="neutral"
          class="min-w-0 truncate p-0"
          :class="s.closed && 'text-muted line-through'"
          @click="open(s.id)"
        >
          {{ s.title }}
        </UButton>
      </li>
    </ul>
    <UInput
      v-model="text"
      :placeholder="$t('drawer.addSubtask')"
      :aria-label="$t('drawer.addSubtask')"
      :disabled="readonly"
      @keydown.enter.prevent="add"
    />
  </section>
</template>
