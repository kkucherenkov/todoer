import {
  TAG,
  UsageError,
  parseQuickAdd,
  type Result,
  type TaskChanges,
  type Write,
} from '@todoer/client-core';

export type QuickAddDraft = {
  text: string;
  /** null means that the title's `#project` marker wins. */
  project: string | null;
  /** Space-separated names; a missing `@` is added. */
  tags: string;
  /** null means that the title's `pN` marker wins. */
  priority: number | null;
  scheduledOn: string;
  dueOn: string;
};

export type QuickAddWriter = {
  mint(
    draft:
      | { kind: 'add'; text: string }
      | { kind: 'edit'; taskId: string; changes: TaskChanges },
  ): Write;
  write(write: Write): Promise<Result>;
};

const tagsOf = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const tag = token.startsWith('@') ? token : `@${token}`;
      if (!TAG.test(tag)) throw new UsageError(`"${tag}" is not a tag`);
      return tag;
    });

/**
 * The title stays core quick-add text. Revealed controls become one follow-up
 * edit, so they can override its grammar without teaching Web another parser:
 * project and priority replace the title's markers, tags add to its `@tags`.
 * Throws `UsageError` for a field tag core's grammar would not read as one.
 */
export function planQuickAdd(draft: QuickAddDraft): {
  addText: string;
  changes: TaskChanges | null;
} {
  const addText = draft.text.trim();
  const parsed = parseQuickAdd(addText);
  const changes: TaskChanges = {};
  if (draft.project !== null) changes.project = draft.project;
  if (draft.tags.trim() !== '') {
    changes.tags = [...new Set([...parsed.tags, ...tagsOf(draft.tags)])];
  }
  if (draft.priority !== null) changes.priority = draft.priority;
  if (draft.scheduledOn !== '') changes.scheduledOn = draft.scheduledOn;
  if (draft.dueOn !== '') changes.dueOn = draft.dueOn;
  return {
    addText,
    changes: Object.keys(changes).length === 0 ? null : changes,
  };
}

type AddWrite = Extract<Write, { kind: 'add' }>;
type EditWrite = Extract<Write, { kind: 'edit' }>;

const addWrite = (db: QuickAddWriter, text: string): AddWrite => {
  const write = db.mint({ kind: 'add', text });
  if (write.kind !== 'add') throw new Error('mint returned a non-add write');
  return write;
};

const editWrite = (
  db: QuickAddWriter,
  taskId: string,
  changes: TaskChanges,
): EditWrite => {
  const write = db.mint({ kind: 'edit', taskId, changes });
  if (write.kind !== 'edit') throw new Error('mint returned a non-edit write');
  return write;
};

/**
 * Holds the minted writes until the whole intent is accepted. Until the add
 * lands it is keyed by the title, so a retry replays the same opId. Once it
 * has landed it is kept: a refused structured edit is retried with the same
 * opId, or re-minted for the same task when the fields changed, and never
 * creates a second task. `created` says the task exists even if the result
 * is a refusal.
 */
export function createQuickAddSubmitter(db: QuickAddWriter) {
  let add: { text: string; write: AddWrite; landed: boolean } | null = null;
  let edit: { key: string; write: EditWrite } | null = null;
  return async (
    draft: QuickAddDraft,
  ): Promise<{ result: Result; taskId: string; created: boolean }> => {
    let plan: ReturnType<typeof planQuickAdd>;
    try {
      plan = planQuickAdd(draft);
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      return {
        result: {
          ok: false,
          failure: { kind: 'invalid', detail: error.message },
        },
        taskId: add?.write.id ?? '',
        created: add?.landed ?? false,
      };
    }

    if (!add?.landed && add?.text !== plan.addText) {
      add = {
        text: plan.addText,
        write: addWrite(db, plan.addText),
        landed: false,
      };
    }
    const taskId = add.write.id;
    if (!add.landed) {
      const result = await db.write(add.write);
      if (!result.ok) return { result, taskId, created: false };
      add.landed = true;
    }

    const key = JSON.stringify(plan.changes);
    if (plan.changes !== null && edit?.key !== key) {
      edit = { key, write: editWrite(db, taskId, plan.changes) };
    }
    const result =
      plan.changes === null
        ? ({ ok: true } as const)
        : await db.write(edit!.write);
    if (result.ok) {
      add = null;
      edit = null;
    }
    return { result, taskId, created: true };
  };
}
