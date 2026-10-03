// Read-only source snapshot: packages/specs/src/filter.ts. Type erasure only; local fixture use.
(()=>{window.TodoerDomain ||= {};
const {addDays, isIsoDate}=window.TodoerDomain;

/** A day offset from the client's local today, or an absolute date. */
                                        
/** Inclusive; an absent bound is open. `{}` matches any date at all. */
                                                             

/**
 * A view's filter (views design, Q6): a boolean tree over predicates,
 * referencing rows by id and dates by offsets from today. Check one with
 * `filterProblem` before storing or evaluating it.
 */
                    
                     
                    
                   
                   
                              
                      
                          
                            
                      
                           

/**
 * What the evaluator needs to know about one task, resolved by the caller:
 * the tags it is attached to, the status a board shows it in (see
 * `displayStatus`), and for a recurring task the dates of its current
 * occurrence.
 */
                          
                            
                           
                          
                   
                             
                       
                     
  

const FILTER_MAX_DEPTH = 8;
const FILTER_MAX_NODES = 256;
const MAX_OFFSET_DAYS = 36_600;
// Lower-case only: Postgres returns uuid columns lower-case and JSONB keeps a
// filter's strings as written, so an upper-case id would never match.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isUuid = (value         )          =>
  typeof value === 'string' && UUID.test(value);

function rangeProblem(value         , path        )                {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${path}: not an object`;
  }
  for (const [key, bound] of Object.entries(value)) {
    if (key !== 'from' && key !== 'to') return `${path}: unknown key ${key}`;
    const offset =
      typeof bound === 'number' &&
      Number.isInteger(bound) &&
      Math.abs(bound) <= MAX_OFFSET_DAYS;
    if (!offset && !isIsoDate(bound)) {
      return `${path}.${key}: not a day offset or a YYYY-MM-DD date`;
    }
  }
  return null;
}

/**
 * Why `filter` is not a valid filter, or `null`. The server calls this on
 * every view write and clients before writing one, so a stored filter is
 * always one `matches` can evaluate. The node budget is checked as the walk
 * goes, so an enormous tree is refused without being walked.
 */
function filterProblem(filter         )                {
  let nodes = 0;
  const check = (node         , depth        , path        )                => {
    if (depth > FILTER_MAX_DEPTH) {
      return `${path}: deeper than ${FILTER_MAX_DEPTH} levels`;
    }
    nodes += 1;
    if (nodes > FILTER_MAX_NODES) {
      return `more than ${FILTER_MAX_NODES} nodes`;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return `${path}: not an object`;
    }
    const keys = Object.keys(node);
    if (keys.length !== 1) return `${path}: needs exactly one key`;
    const key = keys[0]          ;
    const value = (node                           )[key];
    const at = `${path}.${key}`;
    switch (key) {
      case 'and':
      case 'or': {
        if (!Array.isArray(value)) return `${at}: not an array`;
        for (const [i, child] of value.entries()) {
          const problem = check(child, depth + 1, `${at}[${i}]`);
          if (problem !== null) return problem;
        }
        return null;
      }
      case 'not':
        return check(value, depth + 1, at);
      case 'tag':
      case 'status':
        return isUuid(value) ? null : `${at}: not a uuid`;
      case 'project':
        return value === null || isUuid(value)
          ? null
          : `${at}: not a uuid or null`;
      case 'priority':
        return Array.isArray(value) &&
          value.length > 0 &&
          Array.from(value).every(
            (p) => Number.isInteger(p) && p >= 0 && p <= 4,
          )
          ? null
          : `${at}: not a non-empty list of priorities 0-4`;
      case 'scheduled':
      case 'due':
        return rangeProblem(value, at);
      case 'recurring':
        return typeof value === 'boolean' ? null : `${at}: not a boolean`;
      default:
        return `${path}: unknown key ${key}`;
    }
  };
  return check(filter, 1, 'filter');
}

/**
 * How many nodes `filter` has and how deep it goes, counted the way
 * `filterProblem` counts them: every object is a node, the root is depth 1.
 * Total for any input; a non-object counts as one node at its depth.
 */
function filterSize(filter         )                                   {
  const walk = (node         , depth        ) => {
    let nodes = 1;
    let deepest = depth;
    const rec = node                                  ;
    const children =
      typeof rec !== 'object' || rec === null
        ? []
        : 'and' in rec || 'or' in rec
          ? (rec.and ?? rec.or)
          : 'not' in rec
            ? [rec.not]
            : [];
    for (const child of Array.isArray(children) ? children : []) {
      const size = walk(child, depth + 1);
      nodes += size.nodes;
      deepest = Math.max(deepest, size.depth);
    }
    return { nodes, depth: deepest };
  };
  return walk(filter, 1);
}

function inRange(
  date               ,
  range           ,
  today        ,
)          {
  if (date === null) return false;
  const day = (bound           )         =>
    typeof bound === 'string' ? bound : addDays(today, bound);
  return (
    (range.from === undefined || date >= day(range.from)) &&
    (range.to === undefined || date <= day(range.to))
  );
}

/**
 * Whether `task` is in a view with `filter`, on the client's local `today`
 * (`YYYY-MM-DD`). `filter` must have passed `filterProblem`. `today` must be
 * a valid date: an invalid one makes `addDays` throw a RangeError, and there
 * is no guard because callers pass their own clock.
 */
function matches(
  filter        ,
  task            ,
  today        ,
)          {
  if ('and' in filter) return filter.and.every((f) => matches(f, task, today));
  if ('or' in filter) return filter.or.some((f) => matches(f, task, today));
  if ('not' in filter) return !matches(filter.not, task, today);
  if ('tag' in filter) return task.tagIds.includes(filter.tag);
  if ('project' in filter) return task.projectId === filter.project;
  if ('status' in filter) return task.statusId === filter.status;
  if ('priority' in filter) return filter.priority.includes(task.priority);
  if ('scheduled' in filter) {
    return inRange(task.scheduledOn, filter.scheduled, today);
  }
  if ('due' in filter) return inRange(task.dueOn, filter.due, today);
  return task.recurring === filter.recurring;
}

/**
 * `filter` with every tag, project and status id found in `ids` replaced by
 * its value — how a client keeps a view pointing at the row a duplicate was
 * folded into. The same object comes back when nothing changes, so a caller
 * can tell whether a write is needed.
 */
function replaceIds(
  filter        ,
  ids                             ,
)         {
  if ('and' in filter || 'or' in filter) {
    const key = 'and' in filter ? 'and' : 'or';
    const children = 'and' in filter ? filter.and : filter.or;
    const next = children.map((child) => replaceIds(child, ids));
    return next.every((child, i) => child === children[i])
      ? filter
      : ({ [key]: next }          );
  }
  if ('not' in filter) {
    const next = replaceIds(filter.not, ids);
    return next === filter.not ? filter : { not: next };
  }
  for (const key of ['tag', 'project', 'status']         ) {
    if (key in filter) {
      const id = (filter                           )[key];
      const to = typeof id === 'string' ? ids.get(id) : undefined;
      return to === undefined ? filter : ({ [key]: to }          );
    }
  }
  return filter;
}

Object.assign(window.TodoerDomain,{FILTER_MAX_DEPTH,FILTER_MAX_NODES,filterProblem,filterSize,matches,replaceIds});})();
