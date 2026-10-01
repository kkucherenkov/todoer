import { startCadence } from '~/db/cadence';
import { connect, type Db } from '~/db/client';
import { lead } from '~/db/leader';

/** Departure 4: one bit saying a cookie session may exist. */
const HINT = 'todoer.session';

// A storage that throws (blocked, private mode) reads as "no hint".
const readHint = () => {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return false;
  }
};
const writeHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    // Nothing to keep it in: the next load signs in again.
  }
};

export default defineNuxtPlugin(() => {
  // Web Locks, OPFS and the cookie all need a secure context; the page
  // shows the HTTPS message instead (Q11).
  if (!window.isSecureContext) return { provide: { db: null as Db | null } };

  const build = useRuntimeConfig().app.buildId;
  lead(build, readHint);
  const db = connect(build);
  watch(db.topics.session, (session) => {
    if (session?.state === 'signed-in') writeHint(true);
    if (session?.state === 'signed-out') writeHint(false);
  });
  // A sync that fails reports through the sync topic; the reply adds nothing.
  startCadence((reason) => void db.request({ kind: 'sync', reason }));
  return { provide: { db: db as Db | null } };
});
