import type { Pane } from './pi/app-shell.js';

/** The keys, two to a line. Reparent is `>`/`<`: Tab moves the focus. The
 *  keys pi-tui keeps for itself are not listed, nor bound. */
const HELP = [
  'j k ↓ ↑   move            o O     new task / subtask',
  'h l ← →   fold / column   Enter i edit the line',
  'J K       move the task   x Space done / undo',
  'H L       board column    s       skip occurrence',
  '> <       re-parent       m       status',
  'e         details         dd y    delete',
  'Tab       next pane       [ ] v   views',
  'S         statuses        r       sync, retry a ✗',
  '?         this help       q       quit, back in details',
];

/** The help screen; any key closes it. */
export class Help implements Pane {
  readonly hints = 'any key back';

  constructor(private readonly onClose: () => void) {}

  handleInput(): void {
    this.onClose();
  }

  render(): string[] {
    return HELP;
  }

  invalidate(): void {}
}
