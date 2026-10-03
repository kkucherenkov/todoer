// Read-only source snapshot: packages/specs/src/rrule.ts. Type erasure only; local fixture use.
(()=>{window.TodoerDomain ||= {};
const {isIsoDate}=window.TodoerDomain;

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']         ;
                                                
                                                             

/** A parsed rule. `null` means the part was absent, not empty. */
                     
             
                   
                                                          
                              
                           
                            
                       
                                 
                       
                
  

                        
                                                           

const FREQS                      = new Set([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);
const KEYS                      = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'BYSETPOS',
  'COUNT',
  'UNTIL',
  'WKST',
]);
const TIME_KEYS                      = new Set([
  'BYHOUR',
  'BYMINUTE',
  'BYSECOND',
]);
const BYDAY_ITEM = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;

function isWeekday(value        )                   {
  return (WEEKDAYS                     ).includes(value);
}

/** A positive integer, as INTERVAL and COUNT need. */
function positive(key        , value        )                  {
  return /^[1-9]\d{0,5}$/.test(value)
    ? Number(value)
    : `${key} must be a positive integer`;
}

/**
 * A comma list of integers in 1..max, or ±1..max when `signed`. Zero is never
 * valid: RFC 5545 counts from 1 at the start and from -1 at the end.
 */
function ints(
  key        ,
  value        ,
  max        ,
  signed         ,
)                    {
  const out           = [];
  for (const item of value.split(',')) {
    const n = /^[+-]?\d{1,3}$/.test(item) ? Number(item) : NaN;
    const ok = signed
      ? n !== 0 && Math.abs(n) <= max
      : n >= 1 && n <= max && !item.startsWith('+');
    if (!ok) return `${key}: "${item}" is out of range`;
    out.push(n);
  }
  return out;
}

/**
 * Parses the RFC 5545 subset todoer supports (domain design §4). Strict on
 * purpose: keys are upper case, each appears once, and anything outside the
 * subset is an error rather than ignored — a rule one client ignores part of
 * expands differently on another. This is the one copy of "which rules are
 * legal"; the server and every TypeScript client call it (plan C design,
 * Q14).
 */
function parseRrule(text        )             {
  const fail = (error        )             => ({ ok: false, error });
  const parts = new Map                ();
  for (const part of text.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0 || eq === part.length - 1) {
      return fail(`malformed part: "${part}"`);
    }
    const key = part.slice(0, eq);
    if (TIME_KEYS.has(key)) {
      return fail(
        `${key} is not supported: v1 has dates, never times (ADR 0010)`,
      );
    }
    if (!KEYS.has(key)) return fail(`${key} is not supported`);
    if (parts.has(key)) return fail(`${key} appears twice`);
    parts.set(key, part.slice(eq + 1));
  }

  const freq = parts.get('FREQ');
  if (freq === undefined) return fail('FREQ is required');
  if (!FREQS.has(freq)) return fail(`FREQ=${freq} is not supported`);
  const rule        = {
    freq: freq        ,
    interval: 1,
    byDay: null,
    byMonthDay: null,
    byMonth: null,
    bySetPos: null,
    count: null,
    until: null,
    wkst: 'MO',
  };

  for (const [key, value] of parts) {
    if (key === 'INTERVAL' || key === 'COUNT') {
      const n = positive(key, value);
      if (typeof n === 'string') return fail(n);
      if (key === 'INTERVAL') rule.interval = n;
      else rule.count = n;
    } else if (key === 'BYMONTHDAY' || key === 'BYSETPOS') {
      const list = ints(key, value, key === 'BYMONTHDAY' ? 31 : 366, true);
      if (typeof list === 'string') return fail(list);
      if (key === 'BYMONTHDAY') rule.byMonthDay = list;
      else rule.bySetPos = list;
    } else if (key === 'BYMONTH') {
      const list = ints(key, value, 12, false);
      if (typeof list === 'string') return fail(list);
      rule.byMonth = list;
    } else if (key === 'BYDAY') {
      const days                                            = [];
      for (const item of value.split(',')) {
        const m = BYDAY_ITEM.exec(item);
        const day = m?.[2];
        if (m === null || day === undefined || !isWeekday(day)) {
          return fail(`BYDAY: "${item}" is not a weekday`);
        }
        const n = m[1] === undefined ? null : Number(m[1]);
        if (n !== null && (n === 0 || Math.abs(n) > 53)) {
          return fail(`BYDAY: "${item}" is out of range`);
        }
        if (n !== null && freq !== 'MONTHLY' && freq !== 'YEARLY') {
          return fail(
            `BYDAY: "${item}" has an ordinal, which needs FREQ=MONTHLY or YEARLY`,
          );
        }
        days.push({ n, day });
      }
      rule.byDay = days;
    } else if (key === 'UNTIL') {
      const date = /^\d{8}$/.test(value)
        ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
        : null;
      if (date === null || !isIsoDate(date)) {
        return fail('UNTIL must be a date, YYYYMMDD');
      }
      rule.until = date;
    } else if (key === 'WKST') {
      if (!isWeekday(value)) return fail(`WKST: "${value}" is not a weekday`);
      rule.wkst = value;
    }
  }

  if (rule.count !== null && rule.until !== null) {
    return fail('COUNT and UNTIL cannot both be set');
  }
  if (rule.byMonthDay !== null && rule.freq === 'WEEKLY') {
    return fail('BYMONTHDAY cannot be used with FREQ=WEEKLY');
  }
  if (
    rule.bySetPos !== null &&
    rule.byDay === null &&
    rule.byMonthDay === null &&
    rule.byMonth === null
  ) {
    return fail('BYSETPOS needs another BY part to select from');
  }
  return { ok: true, rule };
}

Object.assign(window.TodoerDomain,{WEEKDAYS,parseRrule});})();
