import type { Note } from '@todoer/client-core';

/** The toast after a mark, or a drop into the completing column, with an
 *  Undo that is a new `mark undo`. A recurring task's names both dates. */
export function useMarked() {
  const db = useDb();
  const toast = useToast();
  const fail = useFail();
  const { t } = useI18n();
  return (taskId: string, title: string, mark: 'done' | 'skip', note?: Note) =>
    toast.add({
      title:
        mark === 'skip'
          ? t('list.skipped')
          : note?.occurrence && note.next
            ? t('list.doneRecurring', {
                occurrence: note.occurrence,
                next: note.next,
              })
            : t('list.done'),
      description: title,
      actions: [
        {
          label: t('list.undo'),
          onClick: async () => {
            const result = await db.write({
              kind: 'mark',
              taskId,
              mark: 'undo',
            });
            if (!result.ok) fail(result);
          },
        },
      ],
    });
}
