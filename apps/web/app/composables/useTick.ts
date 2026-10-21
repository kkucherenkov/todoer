/** Ticks a subtask on its parent's occurrence when the parent repeats
 *  (ADR 0009); a one-off parent, or an ended series, has none, and `mark`
 *  refuses an `on` there. A refusal is the failure toast. */
export function useTick() {
  const db = useDb();
  const fail = useFail();
  return async (
    parent: { rrule?: unknown; occurrence?: unknown },
    id: string,
    closed: boolean,
  ) => {
    const { rrule, occurrence } = parent;
    const result = await db.write({
      kind: 'mark',
      taskId: id,
      mark: closed ? 'done' : 'undo',
      ...(typeof rrule === 'string' && typeof occurrence === 'string'
        ? { on: occurrence }
        : {}),
    });
    if (!result.ok) fail(result);
  };
}
