/** A live row of the user's status table, as the board rule needs it. */
export type StatusRow = { id: string; rank: string; completing: boolean };

const byRankThenId = (a: StatusRow, b: StatusRow): number =>
  a.rank < b.rank
    ? -1
    : a.rank > b.rank
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

/** The completing status: with several (merged seed sets), the lowest id. */
export function completingStatus(
  statuses: readonly StatusRow[],
): string | undefined {
  return statuses
    .filter((s) => s.completing)
    .map((s) => s.id)
    .sort()[0];
}

/** Where a task with no status goes: the first non-completing status by
 *  rank, or the first at all when every status is completing. */
export function firstStatus(statuses: readonly StatusRow[]): string | null {
  const ordered = [...statuses].sort(byRankThenId);
  return (ordered.find((s) => !s.completing) ?? ordered[0])?.id ?? null;
}

/**
 * The status a board shows a task in (views design, Q7-Q9). The occurrence
 * wins: a closed current occurrence puts the task in the completing status,
 * an open one never does. Otherwise the task's own status, or — when it has
 * none, its status is deleted, or its status is the completing one — the
 * first non-completing status by rank. With several completing statuses (two
 * seeded sets merged) the lowest id is the completing one. `statuses` are
 * live rows; `null` only when there are none.
 */
export function displayStatus(
  statusId: string | null,
  statuses: readonly StatusRow[],
  occurrenceClosed: boolean,
): string | null {
  const completing = completingStatus(statuses);
  if (occurrenceClosed && completing !== undefined) return completing;
  const own = statuses.find((s) => s.id === statusId);
  return own === undefined || own.completing ? firstStatus(statuses) : own.id;
}
