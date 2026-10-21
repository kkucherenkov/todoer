import {
  parseQuickAdd,
  type Result,
  type TaskChanges,
  type Write,
} from '@todoer/client-core';

export type QuickAddDraft = {
  text: string;
  /** Empty means that the title's `#project` marker wins. */
  project: string;
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
    .map((tag) => (tag.startsWith('@') ? tag : `@${tag}`));

/**
 * The title stays core quick-add text. Revealed controls become one follow-up
 * edit, so they can override its grammar without teaching Web another parser.
 */
export function planQuickAdd(draft: QuickAddDraft): {
  addText: string;
  changes: TaskChanges | null;
} {
  const addText = draft.text.trim();
  const parsed = parseQuickAdd(addText);
  const changes: TaskChanges = {};
  if (draft.project !== '') changes.project = draft.project;
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

type Attempt = {
  key: string;
  add: Extract<Write, { kind: 'add' }>;
  edit: Extract<Write, { kind: 'edit' }> | null;
  added: boolean;
};

const addWrite = (
  db: QuickAddWriter,
  text: string,
): Extract<Write, { kind: 'add' }> => {
  const write = db.mint({ kind: 'add', text });
  if (write.kind !== 'add') throw new Error('mint returned a non-add write');
  return write;
};

const editWrite = (
  db: QuickAddWriter,
  taskId: string,
  changes: TaskChanges,
): Extract<Write, { kind: 'edit' }> => {
  const write = db.mint({ kind: 'edit', taskId, changes });
  if (write.kind !== 'edit') throw new Error('mint returned a non-edit write');
  return write;
};

/**
 * Holds both minted writes until the whole intent is accepted. If add has
 * landed but its structured edit is refused, retry only the same edit: never
 * create a duplicate task.
 */
export function createQuickAddSubmitter(db: QuickAddWriter) {
  let attempt: Attempt | null = null;
  return async (
    draft: QuickAddDraft,
  ): Promise<{ result: Result; taskId: string }> => {
    const key = JSON.stringify(draft);
    if (attempt?.key !== key) {
      const plan = planQuickAdd(draft);
      const add = addWrite(db, plan.addText);
      attempt = {
        key,
        add,
        edit:
          plan.changes === null ? null : editWrite(db, add.id, plan.changes),
        added: false,
      };
    }

    if (!attempt.added) {
      const result = await db.write(attempt.add);
      if (!result.ok) return { result, taskId: attempt.add.id };
      attempt.added = true;
      if (attempt.edit === null) {
        const taskId = attempt.add.id;
        attempt = null;
        return { result, taskId };
      }
    }

    const result = await db.write(attempt.edit!);
    const taskId = attempt.add.id;
    if (result.ok) attempt = null;
    return { result, taskId };
  };
}
