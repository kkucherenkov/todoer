import { describe, it } from 'vitest';

// These cases drove the Ink StatusesScreen through the Ink App, which Task 1.5
// deleted when the entry moved to pi-tui. Task 1.6 ports the screen and
// these cases; the bodies: git show 610ee3e:apps/tui/src/statuses.spec.tsx
describe('StatusesScreen', () => {
  it.todo('lists the statuses in rank order with counts and closes with Esc');
  it.todo('adds a status after the cursor');
  it.todo('renames with Enter');
  it.todo('keeps the input and its text open on a refused rename');
  it.todo('moves a status down with J and up with K, not past the ends');
  it.todo('marks completing with c');
  it.todo('deletes with dd y, naming the tasks that move; dd n keeps it');
  it.todo('says why the completing status cannot be deleted');
});
