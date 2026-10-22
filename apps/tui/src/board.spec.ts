import { describe, it } from 'vitest';

// These cases drove the Ink BoardPane through the Ink App, which Task 1.5
// deleted when the entry moved to pi-tui. Task 1.6 ports the screen and
// these cases; the bodies: git show 610ee3e:apps/tui/src/board.spec.tsx
describe('BoardPane', () => {
  it.todo(
    'shows a column per status with its cards, a subtask named by its parent',
  );
  it.todo('moves the cursor with h/l across columns and j/k along cards');
  it.todo(
    'moves a card right with L, the cursor follows it, and into Done marks it done',
  );
  it.todo('reorders within a column with J/K in a manual view');
  it.todo('says why J does nothing in a view that sorts itself');
  it.todo('adds a card to the current column with o');
  it.todo('inserts with o right below the current card in a manual view');
  it.todo('sends only the add in a view that sorts itself');
  it.todo('keeps the new card’s text when the add is refused');
  it.todo('opens the status picker on a card with m');
  it.todo('scrolls the columns that do not fit with the cursor');
});
