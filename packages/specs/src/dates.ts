const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a real calendar date written `YYYY-MM-DD` — the only form a date
 * takes on the wire (ADR 0010). `2026-02-30` matches the pattern and is
 * refused: the round trip through `Date` moves it to March.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
