import type { Pane } from './pi/app-shell.js';

/** The keys, two to a line. Reparent is `>`/`<`: Tab moves the focus. The
 *  keys pi-tui keeps for itself are not listed, nor bound. Below 90 columns
 *  Enter opens the details and `i` alone edits the line. */
const help = (narrow: boolean) => [
  'j k ↓ ↑   move            n o O   new task / subtask',
  narrow
    ? 'h l ← →   fold / column   i       edit the line'
    : 'h l ← →   fold / column   Enter i edit the line',
  'J K       move the task   x Space done / undo',
  'H L       board column    s       skip occurrence',
  '> <       re-parent       m       status',
  'e         details         dd y    delete',
  narrow
    ? 'Enter     details         /       filter, Esc clears'
    : 'Enter     card details    /       filter, Esc clears',
  'Tab       next pane       [ ] v   views',
  'S         statuses        r       sync, retry a ✗',
  'b         list ⇄ board, not saved',
  '?         this help       q       quit, back in details',
];

/** The help screen; any key closes it. */
export class Help implements Pane {
  readonly hints = 'any key back';

  constructor(
    private readonly onClose: () => void,
    private readonly narrow = false,
  ) {}

  handleInput(): void {
    this.onClose();
  }

  render(): string[] {
    return help(this.narrow);
  }

  invalidate(): void {}
}
