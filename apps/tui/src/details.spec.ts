import { describe, it } from 'vitest';

// These cases drove the Ink DetailsScreen through the Ink App, which Task 1.5
// deleted when the entry moved to pi-tui. Task 1.6 ports the screen and
// these cases; the bodies: git show 610ee3e:apps/tui/src/details.spec.tsx
describe('DetailsScreen', () => {
  it.todo('shows p0 for the highest priority and no label for P4');
  it.todo('shows the fields and closes with Esc');
  it.todo('saves one field alone and closes the line');
  it.todo('keeps a refused line open with its text');
  it.todo('sets a due date, and refuses one that is not a date');
  it.todo('clears a date with an empty line');
  it.todo('moves the task through the status picker');
  it.todo('makes the task repeat daily, and from a raw RRULE');
  it.todo('refuses recurrence on a subtask and lists the subtasks');
  it.todo('edits the notes in $VISUAL');
});
