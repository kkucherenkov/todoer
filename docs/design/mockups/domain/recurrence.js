// Read-only source snapshot: apps/web/app/utils/recurrence.ts. Type erasure only; local fixture use.
(()=>{window.TodoerDomain ||= {};
const {parseRrule, WEEKDAYS,}=window.TodoerDomain;
const {weekday}=window.TodoerDomain;

                                                             
/** `interval` is null while the field is empty. */
                      
             
                          
                   
  

/** Canonical text: FREQ, INTERVAL only when > 1, BYDAY only for WEEKLY and
 *  in WEEKDAYS order. Weekly with no day gives `FREQ=WEEKLY…` with no BYDAY;
 *  the form never sends that (FR-010). Null for an interval that is empty or
 *  not a positive integer: the text would otherwise say 1 silently. */
function toRrule(p        )                {
  if (p.interval === null || !Number.isInteger(p.interval) || p.interval < 1)
    return null;
  const out = [`FREQ=${p.freq}`];
  if (p.interval > 1) out.push(`INTERVAL=${p.interval}`);
  if (p.freq === 'WEEKLY' && p.byDay.length > 0)
    out.push(`BYDAY=${WEEKDAYS.filter((d) => p.byDay.includes(d)).join(',')}`);
  return out.join(';');
}

/** The preset that writes exactly `rrule`, or null (raw mode): unparseable,
 *  a part beyond FREQ/INTERVAL/BYDAY, BYDAY outside WEEKLY or with an
 *  ordinal, Weekly without BYDAY, or text that is not toRrule's own. */
function presetOf(rrule        )                {
  const parsed = parseRrule(rrule);
  if (!parsed.ok) return null;
  const { freq, interval, byDay } = parsed.rule;
  if (byDay?.some((d) => d.n !== null)) return null;
  if (freq === 'WEEKLY' && byDay === null) return null;
  const preset         = {
    freq,
    interval,
    byDay: byDay?.map((d) => d.day) ?? [],
  };
  return toRrule(preset) === rrule ? preset : null;
}

/** Daily, every 1, with the start date's weekday ready for Weekly. */
function blankPreset(dtstart        )         {
  return {
    freq: 'DAILY',
    interval: 1,
    byDay: [WEEKDAYS[weekday(dtstart)]           ],
  };
}

/** Known parser and `ruleProblem` reasons (English, from client-core and
 *  specs) as an i18n key under `recurrence.problem` and its parameters. */
const REASONS                                    = [
  [/^malformed part: "(.*)"$/, 'malformed', ['part']],
  [/^(\w+) is not supported: v1 has dates, never times/, 'time', ['key']],
  [/^(\w+) is not supported$/, 'unsupported', ['key']],
  [/^(\w+) appears twice$/, 'twice', ['key']],
  [/^FREQ is required$/, 'freqRequired', []],
  [/^FREQ=(.*) is not supported$/, 'freqUnsupported', ['value']],
  [/^(\w+) must be a positive integer$/, 'positive', ['key']],
  [/^(\w+): "(.*)" is out of range$/, 'outOfRange', ['key', 'item']],
  [/^BYDAY: "(.*)" is not a weekday$/, 'notWeekday', ['item']],
  [/^BYDAY: "(.*)" has an ordinal/, 'ordinal', ['item']],
  [/^UNTIL must be a date/, 'untilDate', []],
  [/^WKST: "(.*)" is not a weekday$/, 'wkst', ['value']],
  [/^COUNT and UNTIL cannot both be set$/, 'countUntil', []],
  [/^BYMONTHDAY cannot be used with FREQ=WEEKLY$/, 'monthdayWeekly', []],
  [/^BYSETPOS needs another BY part/, 'setpos', []],
  [/^the start must be a date/, 'startDate', []],
  [/^this rule produces no date from (.*)$/, 'noDate', ['date']],
];

/** The i18n key and parameters for a known reason, else null (show the raw
 *  text). */
function reasonKey(
  reason        ,
)                                                         {
  for (const [re, key, names] of REASONS) {
    const m = re.exec(reason);
    if (m)
      return {
        key: `recurrence.problem.${key}`,
        params: Object.fromEntries(names.map((n, i) => [n, m[i + 1] ?? ''])),
      };
  }
  return null;
}

Object.assign(window.TodoerDomain,{toRrule,presetOf,blankPreset,reasonKey});})();
