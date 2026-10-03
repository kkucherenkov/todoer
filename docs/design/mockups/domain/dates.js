// Read-only source snapshot: packages/specs/src/dates.ts. Type erasure only; local fixture use.
(()=>{window.TodoerDomain ||= {};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a real calendar date written `YYYY-MM-DD` — the only form a date
 * takes on the wire (ADR 0010). `2026-02-30` matches the pattern and is
 * refused: the round trip through `Date` moves it to March.
 */
function isIsoDate(value         )                  {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** `date` moved by `days` calendar days. UTC arithmetic: a calendar date has
 *  no time zone, so no daylight-saving shift can move it by an hour. */
function addDays(date        , days        )         {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Object.assign(window.TodoerDomain,{isIsoDate,addDays});})();
