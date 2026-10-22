import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type { Item } from '@todoer/client-core';
import {
  indentTarget,
  insertAfter,
  moveAfter,
  outline,
  type OutlineRow,
} from './outline-tree.js';
import type { Pane } from './pi/app-shell.js';
import { colour, sgr } from './style.js';
import type { Tui } from './tui.js';
import { createWrite } from './write.js';

/** Lines the cursor row may take when its title does not fit. */
const OVERLAY = 3;
const RED = 31;
const YELLOW = 33;

/** Alt-arrow, in the modifyOtherKeys form and as ESC ESC [ A/B. */
const alt = (data: string, dir: 'up' | 'down') =>
  matchesKey(data, Key.alt(dir)) ||
  data === (dir === 'up' ? '\u001b\u001b[A' : '\u001b\u001b[B');

type Deps = {
  tui: Pick<Tui, 'engine' | 'newId' | 'status' | 'topics' | 'today'>;
  /** The task under the cursor, or null; fires when it changes. */
  onSelect: (taskId: string | null) => void;
};

/**
 * The list layout, one line per task: top-level tasks with their listed
 * subtasks nested under them. The cursor row shows its title in full as an
 * overlay over the rows below it (above it near the bottom), so no other row
 * moves. `h`/`l` fold, `>`/`<` re-parent, `J`/`K` move among siblings
 * (manual views only), `o`/`O` add a task or a subtask below the cursor
 * (where the sort puts it in a sorted view), `x`/Space/`s` close, `dd` `y`
 * delete. The caller watches the view's key with the engine and tells this
 * pane which one with `show`.
 */
export class Outline implements Pane {
  /** Rows the pane shows; unset, as many as there are tasks. The root sets
   *  it from the layout so the list scrolls instead of overflowing. */
  height: number | undefined;
  private key = 'all';
  private folded: ReadonlySet<string> = new Set();
  // The cursor follows its task across a move or a re-parent; when the task
  // leaves the view (done, deleted) it stays at the same place.
  private cursor: { at: number; id?: string | undefined } = { at: 0 };
  private top = 0;
  private selected: string | null = null;
  private pendingD = false;
  private deleting = false;
  private input: Input | null = null;
  private focused = true;
  private readonly write: ReturnType<typeof createWrite>;

  constructor(private readonly deps: Deps) {
    this.write = createWrite(deps.tui);
    deps.tui.topics.subscribe(() => this.sync());
  }

  /** A line is being typed: every key is the input's. */
  get inserting(): boolean {
    return this.input !== null;
  }

  /** Waiting for the second `d` or for `y`: the next key is this pane's. */
  get holding(): boolean {
    return this.inserting || this.pendingD || this.deleting;
  }

  /** Without the focus the `▸` is dim. */
  focus(on: boolean): void {
    this.focused = on;
  }

  /** Points the pane at another view's key. */
  show(key: string): void {
    this.key = key;
    this.cursor = { at: 0 };
    this.top = 0;
    this.sync();
  }

  private view = () => this.deps.tui.topics.view(this.key);
  private items = (): Item[] => this.view()?.items ?? [];
  private rows = (): OutlineRow[] => outline(this.items(), this.folded);

  /** Where the cursor is now: on its task, else at the same place. */
  private resolve(rows: OutlineRow[]): number {
    const found = rows.findIndex((r) => r.item.id === this.cursor.id);
    return found >= 0
      ? found
      : Math.max(0, Math.min(rows.length - 1, this.cursor.at));
  }

  /** Tells `onSelect` when the task under the cursor changed. */
  private sync(): void {
    const rows = this.rows();
    const at = this.resolve(rows);
    const row = rows[at];
    // Anchor to a task from the first row on, so a later publish that sorts
    // another task first does not carry the cursor with the index.
    if (row !== undefined && this.cursor.id === undefined) {
      this.cursor = { at, id: String(row.item.id) };
    }
    const next = row === undefined ? null : String(row.item.id);
    if (next === this.selected) return;
    this.selected = next;
    this.deps.onSelect(next);
  }

  private go(rows: OutlineRow[], at: number): void {
    const next = Math.max(0, Math.min(rows.length - 1, at));
    this.cursor = { at: next, id: String(rows[next]?.item.id) };
  }

  private fold(id: string, on: boolean): void {
    const next = new Set(this.folded);
    if (on) next.add(id);
    else next.delete(id);
    this.folded = next;
  }

  private reparent(taskId: string, parentId: string | null): void {
    void this.write((newId) => ({
      kind: 'reparent',
      opId: newId(),
      taskId,
      parentId,
    }));
  }

  private move(taskId: string, step: -1 | 1): void {
    const view = this.view();
    if (view === undefined) return;
    if (view.sort !== 'manual') {
      this.deps.tui.status.say({
        tone: 'info',
        text: 'this view sorts itself: moving needs a manual view',
      });
      return;
    }
    const after = moveAfter(view.items, taskId, step);
    if (after === undefined) return;
    void this.write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId,
      view: view.key,
      after,
    }));
  }

  /** `x`/Space done or undo, `s` skip, `dd` then `y` delete; true when
   *  `data` was one of them. */
  private taskKey(data: string, item: Item): boolean {
    const { status } = this.deps.tui;
    const taskId = String(item.id);
    if (this.deleting) {
      this.deleting = false;
      status.clear();
      if (data === 'y') {
        void this.write((newId) => ({
          kind: 'deleteTask',
          opId: newId(),
          taskId,
        }));
      }
      return true;
    }
    if (data === 'd') {
      if (!this.pendingD) {
        this.pendingD = true;
        return true;
      }
      this.pendingD = false;
      this.deleting = true;
      status.say({
        tone: 'info',
        text: `delete "${String(item.title)}"? y/n`,
      });
      return true;
    }
    this.pendingD = false;
    const mark =
      data === 'x' || data === ' ' ? (item.closed ? 'undo' : 'done') : null;
    if (mark === null && data !== 's') return false;
    void this.write((newId) => ({
      kind: 'mark',
      opId: newId(),
      taskId,
      mark: mark ?? 'skip',
    }));
    return true;
  }

  private add(rows: OutlineRow[], at: number, sub: boolean): void {
    const row = rows[at];
    const view = this.view();
    const parentId = !sub
      ? undefined
      : row === undefined
        ? undefined
        : row.depth === 0
          ? String(row.item.id)
          : String(row.item.parentId);
    const after =
      row === undefined || view === undefined || view.sort !== 'manual'
        ? undefined
        : insertAfter(view.items, row.item, sub);
    const input = new Input({
      prompt: sub && parentId !== undefined ? 'new subtask: ' : 'new: ',
    });
    input.focused = true;
    input.onEscape = () => (this.input = null);
    input.onSubmit = (text) => {
      let id = '';
      // Open until the write is taken: a refusal keeps the text. The engine
      // ranks an add first, so a `move` puts it below the cursor; refused,
      // the task stays where the add put it.
      void this.write((newId) => {
        id = newId();
        return {
          kind: 'add',
          opId: newId(),
          id,
          text,
          ...(parentId === undefined ? {} : { parentId }),
        };
      }).then(async (r) => {
        if (!r.ok) return;
        this.input = null;
        this.cursor = { at, id };
        this.sync();
        if (after === undefined) return;
        await this.write((newId) => ({
          kind: 'move',
          opId: newId(),
          taskId: id,
          view: this.key,
          after,
        }));
      });
    };
    this.input = input;
  }

  handleInput(data: string): void {
    if (this.input !== null) {
      this.input.handleInput(data);
    } else {
      this.dispatch(data);
    }
    this.sync();
  }

  private dispatch(data: string): void {
    const { status } = this.deps.tui;
    const rows = this.rows();
    const at = this.resolve(rows);
    const row = rows[at];
    // Pin the cursor to the task under it before the key acts on it.
    if (row !== undefined) this.cursor = { at, id: String(row.item.id) };
    if (row !== undefined && this.taskKey(data, row.item)) return;
    status.clear();
    const taskId = row === undefined ? '' : String(row.item.id);
    // Before the arrows: Alt-↓ is also a plain ↓ to the matcher.
    if (row !== undefined && (data === 'J' || alt(data, 'down'))) {
      this.move(taskId, 1);
    } else if (row !== undefined && (data === 'K' || alt(data, 'up'))) {
      this.move(taskId, -1);
    } else if (data === 'j' || matchesKey(data, Key.down))
      this.go(rows, at + 1);
    else if (data === 'k' || matchesKey(data, Key.up)) this.go(rows, at - 1);
    else if (data === 'o') this.add(rows, at, false);
    else if (row === undefined) return;
    else if (data === 'O') this.add(rows, at, true);
    else if (data === 'h' || matchesKey(data, Key.left)) {
      if (row.children > 0) this.fold(taskId, true);
    } else if (data === 'l' || matchesKey(data, Key.right)) {
      this.fold(taskId, false);
    } else if (data === '<') {
      // Also a subtask whose parent this view does not list.
      if (typeof row.item.parentId === 'string') this.reparent(taskId, null);
    } else if (data === '>') {
      const target = indentTarget(rows, at);
      if (target === null) {
        status.say({ tone: 'info', text: 'nothing above to indent under' });
      } else {
        this.reparent(taskId, target);
      }
    }
  }

  /** `head` is what stands left of the title; `meta` what stands right. */
  private parts(r: OutlineRow, cursor: boolean) {
    const { item } = r;
    const paint = (code: number, text: string) =>
      colour() ? sgr(code, text) : text;
    const priority = Number(item.priority ?? 4);
    const p =
      priority < 4
        ? `${priority < 2 ? paint(RED, `p${priority}`) : priority < 3 ? paint(YELLOW, `p${priority}`) : `p${priority}`} `
        : '';
    const head = `${cursor ? sgr(this.focused ? 1 : 2, '▸') : ' '} ${'  '.repeat(r.depth)}${item.closed ? '✓' : '○'} ${p}`;
    // A subtask whose parent this view does not list.
    const orphan =
      r.depth === 0 && item.parentTitle !== null
        ? `${item.parentTitle} › `
        : '';
    const overdue =
      typeof item.dueOn === 'string' && item.dueOn < this.deps.tui.today();
    const progress = item.subtasks;
    const meta = [
      ...(r.folded ? [`+${r.children}`] : []),
      ...(item.project === null ? [] : [`#${item.project}`]),
      ...(typeof item.dueOn === 'string'
        ? [overdue ? paint(RED, item.dueOn) : item.dueOn]
        : []),
      ...(progress === null || progress.total === 0
        ? []
        : [`${progress.done}/${progress.total}`]),
    ].join(' ');
    return { head, title: orphan + String(item.title), meta };
  }

  /** One row; the cursor row may take up to `lines` lines when its title
   *  does not fit. The first keeps the meta, the rest are all title. */
  private line(
    r: OutlineRow,
    cursor: boolean,
    width: number,
    lines = OVERLAY,
  ): string[] {
    const { head, title, meta: all } = this.parts(r, cursor);
    const meta = truncateToWidth(all, Math.floor(width / 2), '…');
    const headWidth = visibleWidth(head);
    const room = Math.max(
      1,
      width - headWidth - (meta === '' ? 0 : visibleWidth(meta) + 1),
    );
    const style = (text: string) =>
      cursor ? sgr(1, text) : r.item.closed ? sgr(2, text) : text;
    const tail = meta === '' ? '' : ` ${sgr(2, meta)}`;
    if (!cursor || visibleWidth(title) <= room) {
      return [head + style(truncateToWidth(title, room, '…', true)) + tail];
    }
    const first = wrapTextWithAnsi(title, room)[0] ?? '';
    const rest = title.startsWith(first)
      ? title.slice(first.length).trimStart()
      : '';
    const wrapped =
      rest === '' ? [] : wrapTextWithAnsi(rest, width - headWidth);
    const more = wrapped.slice(0, lines - 1);
    const cut = wrapped.length > more.length || (lines === 1 && rest !== '');
    // The last shown line ends in `…` when the title goes on.
    const text = [first, ...more].map((t, i, all) =>
      cut && i === all.length - 1
        ? truncateToWidth(`${t}…`, i === 0 ? room : width - headWidth, '…')
        : t,
    );
    return text.map((t, i) =>
      i === 0
        ? head + style(truncateToWidth(t, room, '', true)) + tail
        : ' '.repeat(headWidth) + style(t),
    );
  }

  render(width: number): string[] {
    const rows = this.rows();
    const at = this.resolve(rows);
    this.cursor = { at, id: this.cursor.id };
    // A pane with a set height keeps its input line inside it.
    const size = Math.max(
      1,
      this.height === undefined
        ? rows.length
        : this.height - (this.input === null ? 0 : 1),
    );
    if (at < this.top) this.top = at;
    else if (at >= this.top + size) this.top = at - size + 1;
    this.top = Math.max(0, Math.min(this.top, rows.length - size));
    const shown = rows.slice(this.top, this.top + size);
    const problem = this.view()?.problem ?? null;
    const lines =
      problem !== null
        ? [
            `this view cannot be shown: ${colour() ? sgr(YELLOW, problem) : problem}`,
          ]
        : rows.length === 0
          ? [sgr(2, 'nothing here')]
          : shown.map((r) => this.line(r, false, width)[0] ?? '');
    const over = shown[at - this.top];
    if (over !== undefined) {
      const full = this.line(over, true, width, Math.min(OVERLAY, size));
      const r = at - this.top;
      const start =
        r + full.length <= size ? r : Math.max(0, r - full.length + 1);
      lines.splice(start, full.length, ...full);
      lines.length = Math.min(lines.length, size);
    }
    if (this.input !== null) lines.push(...this.input.render(width));
    return lines.map((l) => truncateToWidth(l, width, '', true));
  }

  invalidate(): void {}
}
