import {
  Key,
  type Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {
  createIntent,
  mint,
  type Draft,
  type Item,
  type Write,
} from '@todoer/client-core';
import {
  indentTarget,
  insertAfter,
  insertRow,
  moveAfter,
  outline,
  type OutlineRow,
} from './outline-tree.js';
import type { Pane } from './pi/app-shell.js';
import { colour, sgr } from './style.js';
import { TaskKeys } from './task-keys.js';
import type { Tui } from './tui.js';
import { lineInput } from './ui/line-input.js';
import { createWrite } from './write.js';

/** Lines the cursor row may take when its title does not fit. */
const OVERLAY = 3;
const RED = 31;
const YELLOW = 33;

/** What a filter compares: NFC, case-folded; nothing else is folded. */
const fold = (text: string) => text.normalize('NFC').toLowerCase();

/** Alt-arrow, in the modifyOtherKeys form and as ESC ESC [ A/B. */
const alt = (data: string, dir: 'up' | 'down') =>
  matchesKey(data, Key.alt(dir)) ||
  data === (dir === 'up' ? '\u001b\u001b[A' : '\u001b\u001b[B');

/** A new task on the row where it will appear: typed, saving, or
 *  refused. */
type Adding = {
  /** The task under the cursor when it opened; the row goes after it. */
  anchor: string | undefined;
  sub: boolean;
  parentId: string | undefined;
  /** The `move` anchor that puts it there in a manual view. */
  after: string | undefined;
  text: string;
  input: Input | null;
  /** Sent and not answered yet (the `move` included): no key acts on it. */
  saving: boolean;
  /** The last draft sent, with the task id it names. */
  draft: (Draft<Extract<Write, { kind: 'add' }>> & { id: string }) | undefined;
  refusal: { detail: string; retryable: boolean } | null;
};

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
 * (manual views only), `n` (or `o`) and `O` add a task or a subtask on an
 * input row where it will appear (below the cursor's group; a sorted view
 * then places it by its sort), and the shared task keys
 * (`TaskKeys`). `filter` keeps the rows whose title contains it, and the
 * parents of matching subtasks, dimmed. The caller watches the view's key
 * with the engine and tells this pane which one with `show`.
 */
export class Outline implements Pane {
  /** Rows the pane shows; unset, as many as there are tasks. The root sets
   *  it from the layout so the list scrolls instead of overflowing. */
  height: number | undefined;
  private key = 'all';
  private query = '';
  /** Parents shown only for a matching subtask. */
  private context: ReadonlySet<string> = new Set();
  /** Tasks added under the filter: shown until its text changes. */
  private pinned = new Set<string>();
  private folded: ReadonlySet<string> = new Set();
  // The cursor follows its task across a move or a re-parent; when the task
  // leaves the view (done, deleted) it stays at the same place.
  private cursor: { at: number; id?: string | undefined } = { at: 0 };
  private top = 0;
  private selected: string | null = null;
  private adding: Adding | null = null;
  private focused = true;
  private readonly write: ReturnType<typeof createWrite>;
  private readonly keys: TaskKeys;
  /** The add, held until taken or refused for good (Q8). */
  private readonly intent: ReturnType<typeof createIntent>;

  constructor(private readonly deps: Deps) {
    this.write = createWrite(deps.tui);
    this.keys = new TaskKeys({ tui: deps.tui, write: this.write });
    const { engine, newId } = deps.tui;
    this.intent = createIntent({
      mint: (d) => mint(d, newId),
      write: (w) => engine.handle(w, 'tui'),
    });
    deps.tui.topics.subscribe(() => this.sync());
  }

  /** A line is being typed: every key is the input's. */
  get inserting(): boolean {
    return (this.adding?.input ?? null) !== null || this.keys.inserting;
  }

  /** A new task's row, a picker, the second `d` or `y`: the next key is
   *  this pane's. */
  get holding(): boolean {
    return this.adding !== null || this.keys.holding;
  }

  /** The keys of a refused add; undefined otherwise. */
  get hints(): string | undefined {
    const a = this.adding;
    if (a?.saving === true) return 'saving…';
    if (a === null || a.input !== null || a.refusal === null) return undefined;
    return a.refusal.retryable
      ? 'r retry · Enter edit · Esc discard'
      : 'Enter edit · Esc discard';
  }

  /** The task under the cursor, as `onSelect` last said. */
  get taskId(): string | null {
    return this.selected;
  }

  /** Without the focus the `▸` is dim. */
  focus(on: boolean): void {
    this.focused = on;
  }

  /** The `/` text; '' shows every row. */
  get filter(): string {
    return this.query;
  }

  set filter(text: string) {
    if (text !== this.query) this.pinned = new Set();
    this.query = text;
    this.sync();
  }

  /** Points the pane at another view's key. */
  show(key: string): void {
    this.key = key;
    this.query = '';
    this.pinned = new Set();
    this.cursor = { at: 0 };
    this.top = 0;
    this.sync();
  }

  private view = () => this.deps.tui.topics.view(this.key);
  private items = (): Item[] => this.view()?.items ?? [];
  private rows(): OutlineRow[] {
    // The task being added stands in its add's row until it is placed.
    const a = this.adding;
    const saving = a?.saving === true ? a.draft?.id : undefined;
    const items = this.items().filter((i) => i.id !== saving);
    if (this.query === '') {
      this.context = new Set();
      return outline(items, this.folded);
    }
    const q = fold(this.query);
    const hits = new Set(
      items
        .filter(
          (i) =>
            this.pinned.has(String(i.id)) || fold(String(i.title)).includes(q),
        )
        .map((i) => i.id),
    );
    const parents = new Set(
      items.filter((i) => hits.has(i.id)).map((i) => i.parentId),
    );
    this.context = new Set(
      [...parents].filter(
        (p): p is string => typeof p === 'string' && !hits.has(p),
      ),
    );
    return outline(
      items.filter((i) => hits.has(i.id) || parents.has(i.id)),
      this.folded,
    );
  }

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
    // The new subtask shows under its parent.
    if (parentId !== undefined) this.fold(parentId, false);
    const after =
      row === undefined || view === undefined || view.sort !== 'manual'
        ? undefined
        : insertAfter(view.items, row.item, sub);
    this.adding = {
      anchor: row === undefined ? undefined : String(row.item.id),
      sub,
      parentId,
      after,
      text: '',
      input: null,
      saving: false,
      draft: undefined,
      refusal: null,
    };
    this.type(this.adding);
  }

  /** The row index the add takes in `rows`. */
  private place(a: Adding, rows: OutlineRow[]): number {
    const found = rows.findIndex((r) => r.item.id === a.anchor);
    return insertRow(rows, found >= 0 ? found : this.resolve(rows), a.sub);
  }

  /** Opens the add's input on its text. Esc closes it: back to the refusal
   *  when there is one, else the row goes. */
  private type(a: Adding): void {
    a.input = lineInput({
      label: a.parentId === undefined ? 'new:' : 'new subtask:',
      initial: a.text,
      onCancel: () => {
        if (a.refusal === null) this.adding = null;
        else a.input = null;
      },
      onSubmit: (text) => this.send(a, text),
    });
  }

  /** One `add` through the held intent: the same draft (task id and
   *  opId) only to resend a retryable refusal, else a new add. The row is
   *  locked until the answer, and the `move` that follows it in a manual view
   *  (the engine ranks an add first; refused, the task stays where the add
   *  put it), so the task shows once, where the row stood. */
  private send(a: Adding, text: string): void {
    // Not refused for good (no answer, an unexpected error): the first
    // attempt may have applied, so the same text goes again as the same
    // operation and cannot add the task twice.
    if (
      a.draft === undefined ||
      a.draft.text !== text ||
      a.refusal?.retryable !== true
    ) {
      a.draft = {
        kind: 'add',
        id: this.deps.tui.newId(),
        text,
        ...(a.parentId === undefined ? {} : { parentId: a.parentId }),
      };
    }
    const { draft } = a;
    a.text = text;
    a.input = null;
    a.saving = true;
    const fail = (detail: string, retryable: boolean) => {
      a.saving = false;
      a.refusal = { detail, retryable };
    };
    void this.intent(draft)
      .then(async (r) => {
        if (!r.ok) {
          const { kind, detail, retryable } = r.failure;
          // Refused for good, or input the core turned down: a new add.
          fail(
            detail,
            kind === 'refused' ? retryable === true : kind !== 'invalid',
          );
          return;
        }
        const { id } = draft;
        // Under a filter it would vanish if it does not match.
        if (this.query !== '') this.pinned.add(id);
        const { after } = a;
        if (after !== undefined) {
          await this.write((newId) => ({
            kind: 'move',
            opId: newId(),
            taskId: id,
            view: this.key,
            after,
          }));
        }
        if (this.adding !== a) return;
        a.saving = false;
        this.cursor = { at: this.place(a, this.rows()), id };
        this.adding = null;
        this.sync();
      })
      .catch((error: unknown) => {
        fail(
          `unexpected: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      });
  }

  /** The keys of a refused add's row; every other key waits. */
  private refused(a: Adding, data: string): void {
    if (data === 'r' && a.refusal?.retryable === true) this.send(a, a.text);
    else if (matchesKey(data, Key.enter)) this.type(a);
    else if (matchesKey(data, Key.escape)) this.adding = null;
  }

  handleInput(data: string): void {
    const a = this.adding;
    if (a?.saving === true) return;
    if (a?.input) a.input.handleInput(data);
    else if (a !== null) this.refused(a, data);
    else this.dispatch(data);
    this.sync();
  }

  private dispatch(data: string): void {
    const { status } = this.deps.tui;
    const rows = this.rows();
    const at = this.resolve(rows);
    const row = rows[at];
    // Pin the cursor to the task under it before the key acts on it.
    if (row !== undefined) this.cursor = { at, id: String(row.item.id) };
    if (this.keys.handle(data, row?.item, this.key)) return;
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
    else if (data === 'n' || data === 'o') this.add(rows, at, false);
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
    const dim = r.item.closed || this.context.has(String(r.item.id));
    const style = (text: string) =>
      cursor ? sgr(1, text) : dim ? sgr(2, text) : text;
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

  /** The add's lines: its input or its refused text, then the reason. */
  private block(a: Adding, width: number): string[] {
    const head = `  ${a.parentId === undefined ? '' : '  '}`;
    const room = Math.max(1, width - visibleWidth(head) - 2);
    const cross = colour() ? sgr(RED, '✗') : '✗';
    const first = a.saving
      ? `${head}○ ${truncateToWidth(a.text, room - 8, '…')} ${sgr(2, 'saving…')}`
      : a.input === null
        ? `${head}${cross} ${truncateToWidth(a.text, room, '…')}`
        : `${head}○ ${a.input.render(room)[0] ?? ''}`;
    return a.refusal === null
      ? [first]
      : [
          first,
          `${head}  ${sgr(2, truncateToWidth(a.refusal.detail, room, '…'))}`,
        ];
  }

  render(width: number): string[] {
    const rows = this.rows();
    const at = this.resolve(rows);
    this.cursor = { at, id: this.cursor.id };
    // A pane with a set height keeps its editor line inside it.
    const below = this.keys.render(width);
    const a = this.adding;
    const block = a === null ? [] : this.block(a, width);
    const place = a === null ? 0 : this.place(a, rows);
    const total = rows.length + block.length;
    const size = Math.max(
      1,
      this.height === undefined ? total : this.height - below.length,
    );
    // Keep the cursor row, or the whole add, in the pane.
    const [lo, hi] = a === null ? [at, at + 1] : [place, place + block.length];
    if (lo < this.top) this.top = lo;
    else if (hi > this.top + size) this.top = hi - size;
    this.top = Math.max(0, Math.min(this.top, total - size));
    const problem = this.view()?.problem ?? null;
    if (problem !== null) {
      return [
        `this view cannot be shown: ${colour() ? sgr(YELLOW, problem) : problem}`,
        ...below,
      ].map((l) => truncateToWidth(l, width, '', true));
    }
    if (total === 0) {
      return [sgr(2, 'nothing here'), ...below].map((l) =>
        truncateToWidth(l, width, '', true),
      );
    }
    if (a !== null) {
      // The add's row stands where the task will appear: the rows below it
      // move down by its lines, no other row moves.
      const lines: string[] = [];
      for (let i = this.top; i < Math.min(total, this.top + size); i += 1) {
        const r = i < place ? rows[i] : rows[i - block.length];
        lines.push(
          i >= place && i < place + block.length
            ? (block[i - place] ?? '')
            : r === undefined
              ? ''
              : (this.line(r, r === rows[at], width, 1)[0] ?? ''),
        );
      }
      return [...lines, ...below].map((l) =>
        truncateToWidth(l, width, '', true),
      );
    }
    const shown = rows.slice(this.top, this.top + size);
    const lines = shown.map((r) => this.line(r, false, width)[0] ?? '');
    const over = shown[at - this.top];
    if (over !== undefined) {
      const full = this.line(over, true, width, Math.min(OVERLAY, size));
      const r = at - this.top;
      const start =
        r + full.length <= size ? r : Math.max(0, r - full.length + 1);
      lines.splice(start, full.length, ...full);
      lines.length = Math.min(lines.length, size);
    }
    lines.push(...below);
    return lines.map((l) => truncateToWidth(l, width, '', true));
  }

  invalidate(): void {}
}
