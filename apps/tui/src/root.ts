import {
  Key,
  matchesKey,
  sliceByColumn,
  truncateToWidth,
} from '@earendil-works/pi-tui';
import { ALL } from '@todoer/client-core';
import { DetailPane } from './detail-pane.js';
import { columns, modeFor, tooSmall, widths, type Mode } from './layout.js';
import { Outline } from './outline.js';
import type { Pane } from './pi/app-shell.js';
import { Sidebar } from './sidebar.js';
import { renderStatus } from './status-bar.js';
import { sgr } from './style.js';
import type { Tui } from './tui.js';

export type Focus = 'sidebar' | 'outline' | 'detail';

const CYCLE: Focus[] = ['sidebar', 'outline', 'detail'];

const HINTS: Record<Focus | 'INSERT', string> = {
  INSERT: 'Enter save · Esc cancel',
  sidebar: 'j/k move · Enter open · Tab focus · q quit',
  outline:
    'j/k move · o new · x done · dd delete · > < indent · J/K move · e details · Tab focus · [ ] views · r sync · q quit',
  detail: 'Tab focus · q quit',
};

/** The screens Task 1.6 ports from Ink; until then the key says so. */
const UNPORTED: Record<string, string> = {
  v: 'the view picker',
  '?': 'the help',
  S: 'the statuses screen',
  m: 'the status picker',
};

/**
 * The whole screen: sidebar | outline | detail pane at full height, then the
 * two status lines. Below 120 columns a focused sidebar is drawn over the
 * outline; below 90 the focused detail pane takes the screen. Keys go to the
 * focused pane, except the global ones in NORMAL mode. The root watches the
 * engine for the sidebar's key and the outline's selected task.
 */
export class Root implements Pane {
  private readonly sidebar: Sidebar;
  private readonly outline: Outline;
  private readonly detail: DetailPane;
  private focusOn: Focus = 'outline';
  private taskId: string | null = null;
  private watching = '';

  /**
   * Esc closes the innermost thing first. An open input or editor takes Esc
   * itself, before this chain; then each closer in order until one closes
   * something.
   */
  private readonly escape: (() => boolean)[] = [
    // Task 2.2: the refusal shown under its field goes here, before the overlay.
    () => this.closeOverlay(),
    // Task 3.3: the `/` filter goes here, last.
  ];

  constructor(
    private readonly deps: {
      tui: Omit<Tui, 'keys'>;
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
    this.detail = new DetailPane({ topics: tui.topics });
    this.outline = new Outline({
      tui,
      onSelect: (taskId) => {
        this.taskId = taskId;
        this.detail.show(taskId);
        this.watch();
      },
    });
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

  private pick(key: string): void {
    this.sidebar.current = key;
    this.outline.show(key);
    this.watch();
    this.closeOverlay();
  }

  private setFocus(next: Focus): void {
    this.focusOn = next;
    this.sidebar.focus(next === 'sidebar');
    this.outline.focus(next === 'outline');
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

  private step(by: number): void {
    const keys = this.sidebar.rows().map((r) => r.key);
    const at = keys.indexOf(this.sidebar.current);
    const next = keys[(at + by + keys.length) % keys.length];
    if (next !== undefined) this.pick(next);
  }

  /** NORMAL-mode keys for the whole screen; true when `data` was one. */
  private global(data: string): boolean {
    const { engine, status } = this.deps.tui;
    if (matchesKey(data, Key.tab)) {
      const at = CYCLE.indexOf(this.focusOn);
      this.setFocus(CYCLE[(at + 1) % CYCLE.length] ?? 'outline');
    } else if (data === 'e') this.setFocus('detail');
    else if (data === 'q') this.deps.quit();
    else if (data === ']') this.step(1);
    else if (data === '[') this.step(-1);
    else if (data === 'r')
      void engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    else if (data in UNPORTED) {
      status.say({
        tone: 'info',
        text: `${UNPORTED[data] ?? data} is not ported yet`,
      });
    } else return false;
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
    if (this.focusOn === 'outline' && this.outline.holding) {
      this.outline.handleInput(data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.escape.some((close) => close());
      return;
    }
    if (this.global(data)) return;
    if (this.focusOn === 'sidebar') this.sidebar.handleInput(data);
    else if (this.focusOn === 'outline') {
      if (this.mode === 'one' && matchesKey(data, Key.enter)) {
        this.setFocus('detail');
      } else this.outline.handleInput(data);
    }
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
    this.outline.height = body;
    const inserting = this.outline.inserting;
    const hints =
      (inserting ? HINTS.INSERT : HINTS[this.focusOn]) +
      (this.overlay() ? ' · Esc back' : '');
    const status = renderStatus(width, {
      mode: inserting ? 'INSERT' : 'NORMAL',
      sync: this.deps.tui.topics.get('sync'),
      message: this.deps.tui.status.message,
      hints,
    });
    if (this.mode === 'one' && this.focusOn === 'detail') {
      return [
        ...columns([{ lines: this.detail.render(width), width }], body),
        ...status,
      ];
    }
    let middle = this.outline.render(w.outline);
    if (this.overlay()) {
      // Over the outline, which stays where it is under it.
      const side = widths(width, 'three').sidebar;
      const lines = this.sidebar.render(side);
      middle = Array.from(
        { length: body },
        (_, i) =>
          truncateToWidth(lines[i] ?? '', side, '', true) +
          sgr(2, '│') +
          sliceByColumn(middle[i] ?? '', side + 1, w.outline - side - 1, true),
      );
    }
    const parts = [
      ...(w.sidebar > 0
        ? [{ lines: this.sidebar.render(w.sidebar), width: w.sidebar }]
        : []),
      { lines: middle, width: w.outline },
      ...(w.detail > 0
        ? [{ lines: this.detail.render(w.detail), width: w.detail }]
        : []),
    ];
    return [...columns(parts, body), ...status];
  }

  invalidate(): void {}
}
