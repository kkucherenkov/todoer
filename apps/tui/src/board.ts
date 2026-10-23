import {
  Key,
  matchesKey,
  truncateToWidth,
  type Input,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type { Item } from '@todoer/client-core';
import { columns, moveAfterIn, visible } from './board-columns.js';
import type { Pane } from './pi/app-shell.js';
import { colour, sgr } from './style.js';
import { alt, TaskKeys } from './task-keys.js';
import type { Tui } from './tui.js';
import { lineInput } from './ui/line-input.js';
import { createWrite } from './write.js';

/** A column's least width; more columns than fit scroll instead of
 *  narrowing. The columns that fit share the whole width. */
const COLUMN = 22;
const CYAN = 36;

/**
 * The kanban layout: one column per status, the engine's `boardTasks` (the
 * completing column holds the tasks closed in the last seven days); the
 * root draws it across the outline and detail columns. `H`/`L` move a card
 * across columns, `J`/`K` within one in a manual view, `n` (or `o`) adds a
 * card below the current one (where the sort puts it in a sorted view), and
 * the shared task keys (`TaskKeys`). A `│` separates the columns, a rule
 * underlines their headers, and a card's title wraps inside its column with
 * a blank line before the next card. Past `height` the cursor's column
 * scrolls by lines to keep its card whole. `single` shows one column at a
 * time.
 */
export class Board implements Pane {
  height: number | undefined;
  /** One status column at a time, under `STATUS (n/m)`. */
  single = false;
  /** The cursor column's first drawn card. */
  private top = 0;
  private key = 'all';
  private col = 0;
  private row = 0;
  // The card the cursor stays on after it moves; `row` once it is gone.
  private follow: string | null = null;
  private adding: Input | null = null;
  /** The add was sent and not answered: its line takes no key. */
  private saving = false;
  private focused = true;
  private selected: string | null = null;
  private readonly write: ReturnType<typeof createWrite>;
  private readonly keys: TaskKeys;

  constructor(
    private readonly deps: {
      tui: Pick<Tui, 'engine' | 'newId' | 'status' | 'topics'>;
      /** The card under the cursor, or null; fires when it changes. */
      onSelect: (taskId: string | null) => void;
    },
  ) {
    this.write = createWrite(deps.tui);
    this.keys = new TaskKeys({ tui: deps.tui, write: this.write });
    deps.tui.topics.subscribe(() => this.sync());
  }

  /** Not while the add waits for its answer: no key is typed then. */
  get inserting(): boolean {
    return (this.adding !== null && !this.saving) || this.keys.inserting;
  }

  /** While the add waits; undefined otherwise. */
  get hints(): string | undefined {
    return this.saving ? 'saving…' : undefined;
  }

  get holding(): boolean {
    return this.adding !== null || this.keys.holding;
  }

  /** The task under the cursor, as `onSelect` last said. */
  get taskId(): string | null {
    return this.selected;
  }

  focus(on: boolean): void {
    this.focused = on;
  }

  show(key: string): void {
    this.key = key;
    this.col = 0;
    this.row = 0;
    this.follow = null;
    this.sync();
  }

  /** Puts the cursor on `taskId`'s card, if the board shows it. */
  reveal(taskId: string): void {
    const at = this.where().cols.findIndex((c) =>
      c.items.some((i) => i.id === taskId),
    );
    if (at < 0) return;
    this.col = at;
    this.follow = taskId;
    this.sync();
  }

  private view = () => this.deps.tui.topics.view(this.key);

  /** The columns and where the cursor is among them. */
  private where() {
    const cols = columns(
      this.view()?.items ?? [],
      this.deps.tui.topics.get('catalog')?.statuses ?? [],
    );
    const c = Math.max(0, Math.min(this.col, cols.length - 1));
    const cards: Item[] = cols[c]?.items ?? [];
    const followed = cards.findIndex((i) => i.id === this.follow);
    const r =
      followed >= 0
        ? followed
        : Math.max(0, Math.min(this.row, cards.length - 1));
    return { cols, c, cards, r, current: cards[r] };
  }

  private sync(): void {
    const { current } = this.where();
    const next = current === undefined ? null : String(current.id);
    if (next === this.selected) return;
    this.selected = next;
    this.deps.onSelect(next);
  }

  private go(col: number, row: number): void {
    this.col = col;
    this.row = row;
    this.follow = null;
  }

  private toColumn(step: -1 | 1): void {
    const { cols, c, current } = this.where();
    if (current === undefined) return;
    const target = cols[c + step];
    if (target?.id == null) {
      if (cols[c]?.id === null) {
        this.deps.tui.status.say({
          tone: 'info',
          text: 'no statuses: nowhere to move · S adds some',
        });
      }
      return;
    }
    const taskId = String(current.id);
    const statusId = target.id;
    void this.write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId,
      view: this.key,
      statusId,
    }));
    this.col = c + step;
    this.follow = taskId;
  }

  private inColumn(step: -1 | 1): void {
    const { cards, current } = this.where();
    if (current === undefined) return;
    if (this.view()?.sort !== 'manual') {
      this.deps.tui.status.say({
        tone: 'info',
        text: 'this view sorts itself: moving needs a manual view',
      });
      return;
    }
    const taskId = String(current.id);
    const after = moveAfterIn(cards, taskId, step);
    if (after === undefined) return;
    void this.write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId,
      view: this.key,
      after,
    }));
    this.follow = taskId;
  }

  private add(): void {
    const { cols, c, current } = this.where();
    const statusId = c === 0 ? null : (cols[c]?.id ?? null);
    const after =
      this.view()?.sort === 'manual' && current !== undefined
        ? String(current.id)
        : undefined;
    this.adding = lineInput({
      label: 'new:',
      onCancel: () => (this.adding = null),
      onSubmit: (text) => {
        let id = '';
        this.saving = true;
        // Open until the add is taken: a refusal keeps the text. A task
        // with no status shows in the first column (`displayStatus`), so
        // elsewhere a `move` follows the add; it also puts the card below
        // the current one, which the engine ranks within `statusId`'s
        // column.
        void this.write((newId) => {
          id = newId();
          return { kind: 'add', opId: newId(), id, text };
        }).then(async (added) => {
          this.saving = false;
          if (!added.ok) return;
          this.adding = null;
          this.follow = id;
          if (statusId === null && after === undefined) return;
          await this.write((newId) => ({
            kind: 'move',
            opId: newId(),
            taskId: id,
            view: this.key,
            ...(statusId === null ? {} : { statusId }),
            ...(after === undefined ? {} : { after }),
          }));
        });
      },
    });
  }

  handleInput(data: string): void {
    if (this.saving) return;
    if (this.adding !== null) this.adding.handleInput(data);
    else this.dispatch(data);
    this.sync();
  }

  private dispatch(data: string): void {
    const { cols, c, cards, r, current } = this.where();
    // Not before `handle`: it would erase the delete question before `y`.
    if (this.keys.handle(data, current, this.key)) return;
    this.deps.tui.status.clear();
    // Before the arrows: Alt-↓ is also a plain ↓ to the matcher.
    if (data === 'J' || alt(data, 'down')) this.inColumn(1);
    else if (data === 'K' || alt(data, 'up')) this.inColumn(-1);
    else if (data === 'H') this.toColumn(-1);
    else if (data === 'L') this.toColumn(1);
    else if (data === 'h' || matchesKey(data, Key.left)) {
      this.go(Math.max(0, c - 1), 0);
    } else if (data === 'l' || matchesKey(data, Key.right)) {
      this.go(Math.min(cols.length - 1, c + 1), 0);
    } else if (data === 'j' || matchesKey(data, Key.down)) {
      this.go(c, Math.min(cards.length - 1, r + 1));
    } else if (data === 'k' || matchesKey(data, Key.up)) {
      this.go(c, Math.max(0, r - 1));
    } else if (data === 'n' || data === 'o') this.add();
  }

  render(width: number): string[] {
    const { cols, c, r } = this.where();
    const { from, to } = visible(
      cols.length,
      c,
      this.single ? 1 : Math.max(1, Math.floor((width + 1) / (COLUMN + 1))),
    );
    const shown = cols.slice(from, to);
    const n = Math.max(1, shown.length);
    const cw = Math.max(1, Math.floor((width - (n - 1)) / n));
    // The last column takes what the division leaves.
    const wide = (k: number) =>
      k === n - 1 ? Math.max(1, width - (n - 1) * (cw + 1)) : cw;
    const cell = (text: string, k: number) =>
      truncateToWidth(text, wide(k), '…', true);
    const head = shown.map((column, k) => {
      const mark = column.completing ? ' ✓' : '';
      const name = this.single
        ? `${column.name.toUpperCase()}${mark} (${c + 1}/${cols.length})`
        : `${column.name}${mark} (${column.items.length})`;
      return cell(
        ` ${sgr(1, from + k === c && colour() ? sgr(CYAN, name) : name)}`,
        k,
      );
    });
    const rule = shown.map((_, k) => '─'.repeat(wide(k))).join('┼');
    const scroll =
      !this.single && (from > 0 || to < cols.length)
        ? [sgr(2, `columns ${from + 1}–${to} of ${cols.length}`)]
        : [];
    const below = [
      ...scroll,
      ...(this.saving && this.adding !== null
        ? [`new: ${this.adding.getValue()} ${sgr(2, 'saving…')}`]
        : (this.adding?.render(width) ?? this.keys.render(width))),
    ];
    /** A card's title wrapped inside the column under its two-cell mark. */
    const card = (item: Item, cursor: boolean): string[] =>
      wrapTextWithAnsi(
        `${item.parentTitle === null ? '' : `${item.parentTitle} › `}${String(item.title)}`,
        Math.max(1, cw - 2),
      ).map((text, i) => {
        const mark = i === 0 && cursor ? '▸ ' : '  ';
        // A mark as well as inverse: inverse alone is lost without colour.
        if (cursor) {
          return this.focused
            ? sgr(7, `${mark}${text}`)
            : `${i === 0 ? `${sgr(2, '▸')} ` : mark}${text}`;
        }
        return item.closed ? sgr(2, `${mark}${text}`) : `${mark}${text}`;
      });
    // The lines the cursor's card takes in its column.
    let [lo, hi] = [0, 0];
    const stacks = shown.map((column, k) => {
      const lines: string[] = [];
      column.items.forEach((item, at) => {
        if (at > 0) lines.push('');
        const cursor = from + k === c && at === r;
        if (cursor) lo = lines.length;
        lines.push(...card(item, cursor));
        if (cursor) hi = lines.length;
      });
      return lines;
    });
    const room = Math.max(
      1,
      this.height === undefined
        ? Math.max(0, ...stacks.map((s) => s.length))
        : this.height - below.length - 2,
    );
    // The cursor's column scrolls; the others show from their first card.
    if (lo < this.top) this.top = lo;
    else if (hi > this.top + room) this.top = Math.min(lo, hi - room);
    const count = stacks[c - from]?.length ?? 0;
    this.top = Math.max(0, Math.min(this.top, count - room));
    const offset = (k: number) => (from + k === c ? this.top : 0);
    const depth = Math.min(
      room,
      Math.max(0, ...stacks.map((s, k) => s.length - offset(k))),
    );
    const body = Array.from({ length: depth }, (_, line) =>
      stacks.map((s, k) => cell(s[line + offset(k)] ?? '', k)).join('│'),
    );
    return [head.join('│'), rule, ...body, ...below].map((l) =>
      truncateToWidth(l, width, '', true),
    );
  }

  invalidate(): void {}
}
