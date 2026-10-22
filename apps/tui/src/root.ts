import { Key, matchesKey, sliceByColumn } from '@earendil-works/pi-tui';
import { ALL } from '@todoer/client-core';
import { Board } from './board.js';
import { DetailPane } from './detail-pane.js';
import { box } from './frame.js';
import { Help } from './help.js';
import { columns, modeFor, tooSmall, widths, type Mode } from './layout.js';
import { Outline } from './outline.js';
import type { Pane } from './pi/app-shell.js';
import { Sidebar } from './sidebar.js';
import { renderStatus } from './status-bar.js';
import { Statuses } from './statuses.js';
import { colour, sgr } from './style.js';
import type { Tui } from './tui.js';
import { Picker } from './ui/picker.js';

export type Focus = 'sidebar' | 'outline' | 'detail';

const CYCLE: Focus[] = ['sidebar', 'outline', 'detail'];

const HINTS: Record<Exclude<Focus, 'detail'> | 'INSERT' | 'board', string> = {
  INSERT: 'Enter save · Esc cancel',
  sidebar: 'j/k move · Enter open · Tab focus · ? help · q quit',
  outline:
    'j/k move · n new · x done · dd delete · > < indent · J/K move · m status · e details · Tab focus · [ ] views · r sync · ? help · q quit',
  board:
    'h/l column · j/k card · H/L move · J/K order · n new · x done · m status · e details · Tab focus · [ ] views · r sync · ? help · q quit',
};

/** A screen drawn in the outline column (help, view picker, statuses);
 *  while it is open every key is its. */
type Screen = Pane & { hints: string; inserting?: boolean };

/**
 * The whole screen: sidebar | outline | detail pane at full height, then the
 * two status lines. A kanban view draws the board in the outline column, as
 * do the help (`?`), the view picker (`v`) and the statuses (`S`). Below 120
 * columns a focused sidebar is drawn over the outline; below 90 the focused
 * detail pane takes the screen. Keys go to the focused pane, except the
 * global ones in NORMAL mode. The root watches the engine for the sidebar's
 * key and the selected task.
 */
export class Root implements Pane {
  private readonly sidebar: Sidebar;
  private readonly outline: Outline;
  private readonly board: Board;
  private readonly detail: DetailPane;
  private screen: Screen | null = null;
  private focusOn: Focus = 'outline';
  private taskId: string | null = null;
  private watching = '';

  /**
   * Esc closes the innermost thing first. An open input or editor takes Esc
   * itself, before this chain; then each closer in order until one closes
   * something.
   */
  private readonly escape: (() => boolean)[] = [
    () => this.focusOn === 'detail' && this.detail.discard(),
    () => this.closeOverlay(),
    () => this.leaveDetail(),
    // Task 3.3: the `/` filter goes here, last.
  ];

  constructor(
    private readonly deps: {
      tui: Tui;
      rows: () => number;
      columns: () => number;
      quit: () => void;
      /** Asks the terminal for a frame after a change no key caused. */
      redraw?: () => void;
    },
  ) {
    const { tui } = deps;
    this.sidebar = new Sidebar({
      topics: tui.topics,
      onPick: (key) => this.pick(key),
    });
    this.detail = new DetailPane({ tui });
    // Both follow the key; the details show the one the layout draws.
    this.outline = new Outline({ tui, onSelect: () => this.select() });
    this.board = new Board({ tui, onSelect: () => this.select() });
    this.setFocus('outline');
    this.watch();
    tui.topics.subscribe(() => {
      // A deleted view or project falls back to All open.
      const { current } = this.sidebar;
      if (
        current !== ALL &&
        tui.topics.get('catalog') !== undefined &&
        !this.sidebar.rows().some((r) => r.key === current)
      ) {
        this.pick(ALL);
      }
      deps.redraw?.();
    });
    tui.status.subscribe(() => deps.redraw?.());
  }

  /** The key the outline shows. */
  get current(): string {
    return this.sidebar.current;
  }

  get focusAt(): Focus {
    return this.focusOn;
  }

  private signedOut = () =>
    this.deps.tui.topics.get('session')?.state === 'signed-out';

  private watch(): void {
    const view = this.sidebar.current;
    const sent = `${view} ${String(this.taskId)}`;
    if (sent === this.watching) return;
    this.watching = sent;
    void this.deps.tui.engine.handle(
      { kind: 'watch', view, task: this.taskId },
      'tui',
    );
  }

  /** The board for a kanban view, else the outline. */
  private get list(): Outline | Board {
    return this.deps.tui.topics.view(this.sidebar.current)?.layout === 'kanban'
      ? this.board
      : this.outline;
  }

  /** Shows and watches the task under the drawn list's cursor. */
  private select(): void {
    const { taskId } = this.list;
    if (taskId === this.taskId) return;
    this.taskId = taskId;
    this.detail.show(taskId);
    this.watch();
  }

  private pick(key: string): void {
    this.sidebar.current = key;
    this.outline.show(key);
    this.board.show(key);
    this.watch();
    this.closeOverlay();
  }

  private setFocus(next: Focus): void {
    this.focusOn = next;
    this.sidebar.focus(next === 'sidebar');
    this.outline.focus(next === 'outline');
    this.board.focus(next === 'outline');
    this.detail.focus(next === 'detail');
  }

  /** Opens a screen over the outline column, which takes the focus. */
  private open(screen: Screen): void {
    this.setFocus('outline');
    this.screen = screen;
  }

  private close = () => (this.screen = null);

  private viewPicker(): Screen {
    const picker = new Picker({
      title: 'View',
      items: this.sidebar.rows().map((r) => ({ id: r.key, label: r.name })),
      initial: this.sidebar.current,
      onCancel: this.close,
      onPick: (key) => {
        this.close();
        this.pick(key);
      },
    });
    return Object.assign(picker, { hints: 'j/k move · Enter open · Esc back' });
  }

  /** A line or a picker is open in the focused pane: every key is its. */
  private get holding(): boolean {
    return this.focusOn === 'outline'
      ? this.list.holding
      : this.focusOn === 'detail' && this.detail.holding;
  }

  private get inserting(): boolean {
    return (
      this.screen?.inserting ?? (this.list.inserting || this.detail.inserting)
    );
  }

  private get mode(): Mode {
    return modeFor(this.deps.columns());
  }

  /** A focused sidebar under 120 columns, the details under 90. */
  private overlay = () =>
    (this.mode !== 'three' && this.focusOn === 'sidebar') ||
    (this.mode === 'one' && this.focusOn === 'detail');

  private closeOverlay(): boolean {
    if (!this.overlay()) return false;
    this.setFocus('outline');
    return true;
  }

  /** Esc in the detail column gives the focus back to the outline. */
  private leaveDetail(): boolean {
    if (this.focusOn !== 'detail') return false;
    this.setFocus('outline');
    return true;
  }

  private step(by: number): void {
    const keys = this.sidebar.rows().map((r) => r.key);
    const at = keys.indexOf(this.sidebar.current);
    const next = keys[(at + by + keys.length) % keys.length];
    if (next !== undefined) this.pick(next);
  }

  /** NORMAL-mode keys for the whole screen; true when `data` was one. */
  private global(data: string): boolean {
    const { tui } = this.deps;
    if (matchesKey(data, Key.tab)) {
      const at = CYCLE.indexOf(this.focusOn);
      this.setFocus(CYCLE[(at + 1) % CYCLE.length] ?? 'outline');
    } else if (data === 'e') this.setFocus('detail');
    // In the details `q` goes back (the Ink screen's keys).
    else if (data === 'q' && this.focusOn === 'detail') {
      if (!this.closeOverlay()) this.leaveDetail();
    } else if (data === 'q') this.deps.quit();
    else if (data === ']') this.step(1);
    else if (data === '[') this.step(-1);
    // On a refused field in the details `r` resends it; elsewhere it syncs.
    else if (data === 'r') {
      if (!(this.focusOn === 'detail' && this.detail.retry())) {
        void tui.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
      }
    } else if (data === 'v') this.open(this.viewPicker());
    else if (data === '?') this.open(new Help(this.close));
    else if (data === 'S')
      this.open(new Statuses({ tui, onClose: this.close }));
    else return false;
    return true;
  }

  handleInput(data: string): void {
    // Ctrl+C quits from anywhere, a line being typed included.
    if (matchesKey(data, Key.ctrl('c'))) return this.deps.quit();
    // Nothing is drawn but the too-small line, so no key acts blind.
    if (this.signedOut() || tooSmall(this.deps.columns(), this.deps.rows())) {
      if (data === 'q') this.deps.quit();
      return;
    }
    if (this.screen !== null) return this.screen.handleInput?.(data);
    if (this.holding) {
      if (this.focusOn === 'detail') this.detail.handleInput(data);
      else this.list.handleInput(data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.escape.some((close) => close());
      return;
    }
    if (this.global(data)) return;
    if (this.focusOn === 'sidebar') this.sidebar.handleInput(data);
    else if (this.focusOn === 'detail') this.detail.handleInput(data);
    else if (this.mode === 'one' && matchesKey(data, Key.enter)) {
      this.setFocus('detail');
    } else this.list.handleInput(data);
  }

  render(width: number): string[] {
    const rows = this.deps.rows();
    const small = tooSmall(width, rows);
    if (small !== null) return small;
    if (this.signedOut()) {
      return [
        'Not signed in. Run `todoer login`, then start todoer-tui again.',
        sgr(2, 'q quit'),
      ];
    }
    const w = widths(width, this.mode);
    const body = rows - 2;
    // Each pane draws inside its box: one cell and one row less each way.
    this.outline.height = body - 2;
    this.board.height = body - 2;
    this.detail.height = body - 2;
    const framed = (
      focus: Focus,
      title: string,
      lines: string[],
      boxWidth: number,
    ) =>
      box(lines, {
        width: boxWidth,
        height: body,
        title,
        active: this.focusOn === focus,
        color: colour(),
      });
    const { inserting, list } = this;
    const hints =
      this.focusOn === 'detail'
        ? this.detail.hints
        : this.screen === null &&
            list === this.outline &&
            this.outline.hints !== undefined
          ? this.outline.hints
          : inserting
            ? HINTS.INSERT
            : (this.screen?.hints ??
              (this.focusOn === 'outline' && list === this.board
                ? HINTS.board
                : HINTS[this.focusOn]) + (this.overlay() ? ' · Esc back' : ''));
    const status = renderStatus(width, {
      mode: inserting ? 'INSERT' : 'NORMAL',
      sync: this.deps.tui.topics.get('sync'),
      message: this.deps.tui.status.message,
      hints,
    });
    if (this.mode === 'one' && this.focusOn === 'detail') {
      const lines = this.detail.render(width - 2);
      return [...framed('detail', 'Details', lines, width), ...status];
    }
    const middle = framed(
      'outline',
      'Tasks',
      (this.screen ?? list).render(w.outline - 2),
      w.outline,
    );
    const side = widths(width, 'three').sidebar;
    const sidebar = (boxWidth: number) =>
      framed('sidebar', 'Views', this.sidebar.render(boxWidth - 2), boxWidth);
    // Over the outline, which stays where it is under it.
    const over = this.overlay() ? sidebar(side) : [];
    const parts = [
      ...(w.sidebar > 0
        ? [{ lines: sidebar(w.sidebar), width: w.sidebar }]
        : []),
      {
        lines: this.overlay()
          ? over.map(
              (l, i) =>
                l +
                sliceByColumn(middle[i] ?? '', side, w.outline - side, true),
            )
          : middle,
        width: w.outline,
      },
      ...(w.detail > 0
        ? [
            {
              lines: framed(
                'detail',
                'Details',
                this.detail.render(w.detail - 2),
                w.detail,
              ),
              width: w.detail,
            },
          ]
        : []),
    ];
    return [...columns(parts, body), ...status];
  }

  invalidate(): void {}
}
