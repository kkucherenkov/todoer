import { connect, HINT, type Db } from '~/db/client';
import { forgetOpfs } from '~/db/forget-opfs';

// Departure 4: HINT is one bit saying a cookie session may exist.
/** Set once the old version's OPFS replica is gone. */
const FORGOTTEN = 'todoer.opfs-forgotten';

// A storage that throws (blocked, private mode) reads as unset.
const read = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const write = (key: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Nothing to keep it in: the next load asks again.
  }
};

export default defineNuxtPlugin(() => {
  // The cookie needs a secure context; the page shows the HTTPS message
  // instead (Q11).
  if (!window.isSecureContext) return { provide: { db: null as Db | null } };

  if (!read(FORGOTTEN)) {
    void forgetOpfs().then((done) => done && write(FORGOTTEN, true));
  }
  const db = connect(read(HINT), {
    remember: (on) => write(HINT, on),
    events: window,
  });
  return { provide: { db } };
});
