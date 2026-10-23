import {
  getKeybindings,
  TuiAltScreen,
  type Component,
  type Terminal,
} from '@earendil-works/pi-tui';

/** A root component that can be told it has the keyboard. */
export interface Pane extends Component {
  focus?(on: boolean): void;
}

/** The viewport scroll keys the library binds under `tui.altScreen.*`; the
 *  app scrolls its own lists. */
// Still consumed by the library before the app sees them: Ctrl+Shift+F
// (search), Ctrl+Up/Down and Ctrl+Shift+Up/Down (prompt jumps).
const UNBOUND = {
  'tui.altScreen.pageUp': [],
  'tui.altScreen.pageDown': [],
  'tui.altScreen.top': [],
  'tui.altScreen.bottom': [],
};

const SIGNALS = { SIGTERM: 143, SIGINT: 130 } as const;

/** Kitty keyboard flags of the current screen set to 0 (`CSI = flags ; 1 u`),
 *  the stack untouched. */
const KITTY_FLAGS_OFF = '\u001b[=0;1u';

/**
 * The alternate screen around `root`. The mouse is not captured (the
 * terminal keeps selection), and the last frame is not dumped into the
 * scrollback on exit. pi-tui restores the terminal on an uncaught exception
 * but handles no signal, so SIGTERM and SIGINT stop the shell here.
 *
 * pi-tui pushes the kitty keyboard flags on the alternate screen and pops
 * them there, which is right, yet Orca's terminal (xterm.js) was left with
 * them on the main screen after a session with live output: the shell then
 * received every key release as `CSI …;1:3u`. The shell sets no flags of its
 * own, so the main screen's are set back to 0 after leaving.
 */
export function createShell(deps: {
  terminal: Terminal;
  root: Pane;
  onExit: (code: number) => void;
}) {
  const { terminal, root, onExit } = deps;
  const keybindings = getKeybindings();
  const before = keybindings.getUserBindings();
  keybindings.setUserBindings({ ...before, ...UNBOUND });
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  tui.setLayoutRoot(root);
  tui.setFocus(root);
  let stopped = false;
  const handlers = Object.entries(SIGNALS).map(([signal, code]) => {
    const handler = () => stop(code);
    return [signal as keyof typeof SIGNALS, handler] as const;
  });
  function stop(code = 0): void {
    if (stopped) return;
    stopped = true;
    for (const [signal, handler] of handlers) process.off(signal, handler);
    keybindings.setUserBindings(before);
    try {
      tui.stop({ preserveScreen: true });
      terminal.write(KITTY_FLAGS_OFF);
    } finally {
      onExit(code);
    }
  }
  return {
    start(): void {
      for (const [signal, handler] of handlers) process.on(signal, handler);
      tui.start();
    },
    stop,
    rows: () => terminal.rows,
    /** A frame for a change no key caused (a publish, a message). */
    requestRender: () => tui.requestRender(),
  };
}
