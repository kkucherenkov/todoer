// Read-only source snapshot: apps/web/app/utils/calendar.ts. Type erasure only; local fixture use.
(()=>{window.TodoerDomain ||= {};
                                                                 
                                          
                                            

                                    

/** The write a move minted: its `id` is the copy undoMove deletes. */
                                                         

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// A calendar date has no zone (ADR 0010): everything below is UTC arithmetic
// on epoch days, never a local `Date`.
const epoch = (date        )         => Date.parse(`${date}T00:00:00.000Z`);
const iso = (ms        )         => new Date(ms).toISOString().slice(0, 10);
const parts = (date        ) =>
  date.split('-').map(Number)                            ;

function real(value         )                  {
  return (
    typeof value === 'string' && ISO.test(value) && iso(epoch(value)) === value
  );
}

/** 0 = Monday … 6 = Sunday (departure 7). UTC: a date has no zone. */
function weekday(date        )         {
  return (new Date(epoch(date)).getUTCDay() + 6) % 7;
}

const monday = (date        )         => iso(epoch(date) - weekday(date) * DAY);

/** The days a grid shows: Monday to Sunday of `at`'s week, or every week
 *  that holds a day of `at`'s month (28 to 42 days). */
function gridSpan(mode      , at        )       {
  if (mode === 'week') {
    const from = monday(at);
    return { from, to: iso(epoch(from) + 6 * DAY) };
  }
  const [y, m] = parts(at);
  const first = iso(Date.UTC(y, m - 1, 1));
  const last = iso(Date.UTC(y, m, 0));
  return {
    from: monday(first),
    to: iso(epoch(monday(last)) + 6 * DAY),
  };
}

/** Every date of a span, in order. */
function days(span      )           {
  const out           = [];
  for (let t = epoch(span.from); t <= epoch(span.to); t += DAY)
    out.push(iso(t));
  return out;
}

/** `at` moved by `n` weeks or months; a month move lands on the 1st. */
function shift(mode      , at        , n        )         {
  if (mode === 'week') return iso(epoch(at) + n * 7 * DAY);
  const [y, m] = parts(at);
  return iso(Date.UTC(y, m - 1 + n, 1));
}

/** The `?mode=&at=` query read back; anything invalid falls back to
 *  week mode at `today`. */
function fromQuery(
  query                         ,
  today        ,
)                             {
  const { mode, at } = query;
  return (mode === 'week' || mode === 'month') && real(at)
    ? { mode, at }
    : { mode: 'week', at: today };
}

/** The write a placement dropped on `to` sends, and the write that undoes
 *  it (departure 6). A recurring scheduled placement moves its occurrence;
 *  any other sets its own date. null when `to` is the placement's day. */
function placeWrite(
  p           ,
  task      ,
  to        ,
)                                                           {
  if (to === p.date) return null;
  const taskId = String(task.id);
  if (p.occurrence !== null) {
    return {
      write: {
        kind: 'moveOccurrence',
        taskId: taskId,
        occurrence: p.occurrence,
        to,
      },
      undo: (minted) => ({ kind: 'undoMove', taskId: minted.id }),
    };
  }
  const field = p.kind === 'due' ? 'dueOn' : 'scheduledOn';
  return {
    write: { kind: 'edit', taskId: taskId, changes: { [field]: to } },
    undo: () => ({
      kind: 'edit',
      taskId: taskId,
      changes: { [field]: p.date },
    }),
  };
}

Object.assign(window.TodoerDomain,{weekday,gridSpan,days,shift,fromQuery,placeWrite});})();
