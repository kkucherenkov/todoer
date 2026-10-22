import {
  Editor,
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui';
import {
  ALL,
  createIntent,
  mint,
  type Draft,
  type Rule,
  type TaskChanges,
  type TaskDetails,
} from '@todoer/client-core';
import {
  customRule,
  describeRule,
  parseDate,
  parsePriority,
  parseTags,
  presets,
} from './fields.js';
import type { Pane } from './pi/app-shell.js';
import { withEscape } from './pi/adapter.js';
import { sgr } from './style.js';
import type { Tui } from './tui.js';
import { lineInput } from './ui/line-input.js';
import { Picker } from './ui/picker.js';
import { createWrite } from './write.js';

type FieldId =
  | 'title'
  | 'project'
  | 'tags'
  | 'priority'
  | 'status'
  | 'scheduledOn'
  | 'dueOn'
  | 'repeat'
  | 'notes';
const FIELDS: { id: FieldId; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'project', label: 'Project' },
  { id: 'tags', label: 'Tags' },
  { id: 'priority', label: 'Priority' },
  { id: 'status', label: 'Status' },
  { id: 'scheduledOn', label: 'Scheduled' },
  { id: 'dueOn', label: 'Due' },
  { id: 'repeat', label: 'Repeat' },
  { id: 'notes', label: 'Notes' },
];
/** A field's label column: the value, an input or an editor starts here. */
const LABEL = 11;
const label = (text: string) => `${sgr(2, text.padEnd(LABEL - 1))} `;

const dateOf = (value: unknown) => (typeof value === 'string' ? value : '');
const priorityOf = (task: TaskDetails) => {
  const p = Number(task.priority ?? 4);
  return p < 4 ? `p${String(p)}` : '';
};
const linesOf = (text: string) => {
  const n = text.split('\n').length;
  return n === 1 ? '1 line' : `${String(n)} lines`;
};
const keyOf = (taskId: string, field: FieldId) => `${taskId} ${field}`;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What each row shows; '' reads as "—". */
function shownOf(
  task: TaskDetails,
  statusName: string | undefined,
): Record<FieldId, string> {
  return {
    title: String(task.title),
    project: task.project ?? '',
    tags: task.tags.join(' '),
    priority: priorityOf(task),
    status: statusName ?? '',
    scheduledOn: dateOf(task.scheduledOn),
    dueOn: dateOf(task.dueOn),
    repeat:
      typeof task.parentId === 'string'
        ? 'with its parent'
        : describeRule(task.rrule),
    notes: task.notes === null ? '' : linesOf(task.notes),
  };
}

/** The field being edited, and whether it is typed into (INSERT). */
type Open = { field: FieldId; component: Component; typing: boolean };
/** A field write the server refused: the person's draft and why. */
type Refusal = { draft: Draft; detail: string; retryable: boolean };

/** What a draft would make of the task, to show the person's value. */
const patchOf = (draft: Draft): Partial<TaskDetails> =>
  draft.kind === 'edit'
    ? draft.changes
    : draft.kind === 'move'
      ? { column: draft.statusId ?? null }
      : draft.kind === 'setRule'
        ? { rrule: draft.rule?.rrule ?? null }
        : {};

/**
 * The selected task's fields as one flat list, then its subtasks with their
 * progress. Focused, j/k move over both. Enter edits the field where it
 * stands: an input on its row, a picker for the status and the repeat, the
 * multi-line `Editor` for the notes. Enter saves, Esc cancels. Each save is
 * one write, held per task and field as one intent (`createIntent`), so
 * sending it again is the same operation. A refused write stays on its
 * field, marked ✗ with the person's value and `saved → yours · reason`
 * under it, until `r` resends it or Esc discards it; refusals are kept per
 * task and field, so they outlive selecting another task. An open field
 * stays open when another client deletes its task: the pane says so, and a
 * save sends nothing. x or Space on a subtask ticks it at the parent's
 * occurrence.
 */
export class DetailPane implements Pane {
  /** Rows the pane shows; past them it scrolls to the cursor. */
  height: number | undefined;
  private taskId: string | null = null;
  private at = 0;
  private focused = false;
  private open: Open | null = null;
  /** The shown task as last drawn: an open field stays drawn on it after
   *  another client deletes the task. */
  private last: TaskDetails | undefined;
  /** One held intent per `taskId field`. */
  private readonly intents = new Map<string, ReturnType<typeof createIntent>>();
  private readonly refusals = new Map<string, Refusal>();
  /** The last draft sent per `taskId field`: an answer to an older one is
   *  stale, so only the latest can be refused, and retried. */
  private readonly latest = new Map<string, Draft>();
  private readonly write: ReturnType<typeof createWrite>;

  constructor(
    private readonly deps: {
      tui: Pick<Tui, 'engine' | 'newId' | 'status' | 'topics' | 'today'>;
    },
  ) {
    this.write = createWrite(deps.tui);
  }

  show(taskId: string | null): void {
    if (taskId !== this.taskId) {
      this.open = null;
      this.last = undefined;
    }
    this.taskId = taskId;
  }

  focus(on: boolean): void {
    this.focused = on;
  }

  /** A field is being edited: every key is the editor's. */
  get holding(): boolean {
    return this.open !== null;
  }

  get inserting(): boolean {
    return this.open?.typing ?? false;
  }

  /** The keys of what the cursor is on. */
  get hints(): string {
    if (this.open === null) {
      const refused = this.refused();
      if (refused !== undefined) {
        return refused.retryable
          ? 'j/k field · Enter edit · r retry · Esc discard · Tab focus · q back'
          : 'j/k field · Enter edit · Esc discard · Tab focus · q back';
      }
      return this.at < FIELDS.length
        ? 'j/k field · Enter edit · Tab focus · Esc q back'
        : 'j/k move · x tick · Tab focus · Esc q back';
    }
    if (!this.open.typing) return 'j/k move · Enter pick · Esc cancel';
    return this.open.field === 'notes'
      ? 'Enter save · Alt+Enter newline · Esc cancel'
      : 'Enter save · Esc cancel';
  }

  private task(): TaskDetails | null | undefined {
    return this.taskId === null
      ? null
      : this.deps.tui.topics.task(this.taskId)?.task;
  }

  private close = () => (this.open = null);

  /** Why a save cannot go: the task was deleted while its field was open. */
  private gone(): string | undefined {
    return this.task() === null
      ? 'this task was deleted: Esc drops the edit'
      : undefined;
  }

  /** The field under the cursor, on the shown task. */
  private key(): string | undefined {
    const field = FIELDS[this.at];
    return field === undefined || this.taskId === null
      ? undefined
      : keyOf(this.taskId, field.id);
  }

  /** The refusal under the cursor. */
  private refused(): Refusal | undefined {
    const key = this.key();
    return key === undefined ? undefined : this.refusals.get(key);
  }

  /** `r`: resends the refused write under the cursor, same opId, when the
   *  server kept no verdict for it; a verdict it kept it would repeat. */
  retry(): boolean {
    const key = this.key();
    const refusal = this.refused();
    if (key === undefined || refusal?.retryable !== true) return false;
    this.send(key, refusal.draft);
    return true;
  }

  /** Esc: drops the refusal under the cursor; the saved value shows. */
  discard(): boolean {
    const key = this.key();
    return key !== undefined && this.refusals.delete(key);
  }

  /** Sends `draft` as the field's held intent; a refusal is kept on the
   *  field. Offline is not one: the engine queues the write and says ok. */
  private send(key: string, draft: Draft): void {
    const { engine, newId } = this.deps.tui;
    let intent = this.intents.get(key);
    if (intent === undefined) {
      intent = createIntent({
        mint: (d) => mint(d, newId),
        write: (w) => engine.handle(w, 'tui'),
      });
      this.intents.set(key, intent);
    }
    // A new draft supersedes the refused one: `r` must not send it again.
    if (this.refusals.get(key)?.draft !== draft) this.refusals.delete(key);
    this.latest.set(key, draft);
    void intent(draft).then((result) => {
      if (this.latest.get(key) !== draft) return;
      this.latest.delete(key);
      if (result.ok) this.refusals.delete(key);
      else {
        const { detail, retryable = false } = result.failure;
        this.refusals.set(key, { draft, detail, retryable });
      }
    });
  }

  /** One `edit` with `changes` alone; nothing when they change nothing.
   *  Says why when the task is gone, and keeps the field open. */
  private edit(
    task: TaskDetails,
    field: FieldId,
    changes: TaskChanges,
  ): string | undefined {
    const problem = this.gone();
    if (problem !== undefined) return problem;
    this.close();
    const changed = Object.entries(changes).some(([k, v]) => !same(task[k], v));
    if (changed) {
      const taskId = String(task.id);
      this.send(keyOf(taskId, field), { kind: 'edit', taskId, changes });
    }
    return undefined;
  }

  /** An input on the field's row. `submit` acts on the text, or says why
   *  it cannot: that is said on the status line and the text kept. */
  private line(
    field: FieldId,
    initial: string,
    submit: (text: string) => string | undefined,
  ): void {
    const component = lineInput({
      label: '',
      initial,
      onCancel: this.close,
      onSubmit: (text) => this.say(submit(text)),
    });
    this.open = { field, component, typing: true };
  }

  /** Says `problem` on the status line; true when there was one. */
  private say(problem: string | undefined): boolean {
    if (problem === undefined) return false;
    this.deps.tui.status.say({ tone: 'error', text: problem });
    return true;
  }

  /** Opens `id` on `view`'s value (the person's, under a refusal); a save
   *  is compared with `task`, the saved one. */
  private openField(task: TaskDetails, id: FieldId, view = task): void {
    const { tui } = this.deps;
    const taskId = String(task.id);
    const shown = shownOf(view, undefined);
    const dtstart =
      task.dtstart ??
      (typeof task.scheduledOn === 'string' ? task.scheduledOn : tui.today());
    const date = (field: 'scheduledOn' | 'dueOn') =>
      this.line(field, shown[field], (text) => {
        const value = parseDate(text);
        return value === false
          ? 'a date is YYYY-MM-DD; empty clears it'
          : this.edit(task, field, { [field]: value });
      });
    switch (id) {
      case 'title':
        return this.line(id, shown.title, (title) =>
          this.edit(task, id, { title }),
        );
      case 'project':
        return this.line(id, shown.project, (text) => {
          const name = text.trim().replace(/^#/, '');
          return this.edit(task, id, { project: name === '' ? null : name });
        });
      case 'tags':
        return this.line(id, shown.tags, (text) =>
          this.edit(task, id, { tags: parseTags(text) }),
        );
      case 'priority':
        return this.line(id, shown.priority, (text) => {
          const priority = parsePriority(text);
          return priority === 'invalid'
            ? 'priority is p0 to p4'
            : this.edit(task, id, { priority });
        });
      case 'status': {
        const statuses = tui.topics.get('catalog')?.statuses ?? [];
        if (statuses.length === 0) {
          tui.status.say({
            tone: 'info',
            text: 'no statuses yet — S to add one',
          });
          return;
        }
        const component = new Picker({
          items: statuses.map((s) => ({
            id: s.id,
            label: s.completing ? `${s.name} ✓` : s.name,
          })),
          ...(view.column === null ? {} : { initial: view.column }),
          onCancel: this.close,
          onPick: (statusId) => {
            if (this.say(this.gone())) return;
            this.close();
            if (statusId === task.column) return;
            this.send(keyOf(taskId, id), {
              kind: 'move',
              taskId,
              view: ALL,
              statusId,
            });
          },
        });
        this.open = { field: id, component, typing: false };
        return;
      }
      case 'scheduledOn':
      case 'dueOn':
        return date(id);
      case 'repeat': {
        if (typeof task.parentId === 'string') {
          tui.status.say({
            tone: 'info',
            text: 'a subtask repeats with its parent',
          });
          return;
        }
        const choices = presets(dtstart);
        const component = new Picker({
          items: [
            ...choices.map((p) => ({ id: p.id, label: p.label })),
            { id: 'custom', label: 'custom RRULE…' },
          ],
          onCancel: this.close,
          onPick: (pick) => {
            const preset = choices.find((p) => p.id === pick);
            const setRule = (rule: Rule | null): string | undefined => {
              const problem = this.gone();
              if (problem !== undefined) return problem;
              this.close();
              this.send(keyOf(taskId, id), { kind: 'setRule', taskId, rule });
              return undefined;
            };
            if (preset !== undefined) {
              this.say(setRule(preset.rule(dtstart)));
              return;
            }
            this.line(id, view.rrule ?? '', (text) => {
              const rule = customRule(text, dtstart);
              return typeof rule === 'string' ? rule : setRule(rule);
            });
          },
        });
        this.open = { field: id, component, typing: false };
        return;
      }
      case 'notes': {
        const rows = () => this.height ?? 24;
        // The editor asks its TUI for the terminal's height (it shows 30% of
        // it) and for a frame; the root draws after every key anyway.
        const host = {
          requestRender: () => undefined,
          terminal: {
            get rows() {
              return rows();
            },
          },
        } as unknown as TUI;
        const editor = new Editor(host, {
          borderColor: (s) => sgr(2, s),
          selectList: {
            selectedPrefix: (s) => s,
            selectedText: (s) => s,
            description: (s) => s,
            scrollInfo: (s) => s,
            noMatch: (s) => s,
          },
        });
        editor.focused = true;
        editor.setText(view.notes ?? '');
        editor.onSubmit = (text) => {
          // The editor empties itself before it calls this.
          const problem = this.edit(task, id, {
            notes: text === '' ? null : text,
          });
          if (this.say(problem)) editor.setText(text);
        };
        this.open = {
          field: id,
          component: withEscape(editor, this.close),
          typing: true,
        };
      }
    }
  }

  /** x/Space on a subtask: done or undo at the parent's occurrence. */
  private tick(task: TaskDetails, at: number): void {
    const sub = task.subtasks[at];
    if (sub === undefined) return;
    const on =
      typeof task.rrule === 'string' && typeof task.occurrence === 'string'
        ? { on: task.occurrence }
        : {};
    void this.write((newId) => ({
      kind: 'mark',
      opId: newId(),
      taskId: sub.id,
      mark: sub.closed ? 'undo' : 'done',
      ...on,
    }));
  }

  handleInput(data: string): void {
    if (this.open !== null) {
      this.open.component.handleInput?.(data);
      return;
    }
    this.deps.tui.status.clear();
    const task = this.task();
    const rows = FIELDS.length + (task?.subtasks.length ?? 0);
    if (data === 'j' || matchesKey(data, Key.down)) {
      this.at = Math.min(rows - 1, this.at + 1);
    } else if (data === 'k' || matchesKey(data, Key.up)) {
      this.at = Math.max(0, this.at - 1);
    } else if (task == null) {
      return;
    } else if (this.at >= FIELDS.length) {
      if (data === 'x' || data === ' ')
        this.tick(task, this.at - FIELDS.length);
    } else if (matchesKey(data, Key.enter)) {
      const field = FIELDS[this.at];
      if (field !== undefined) {
        this.openField(task, field.id, this.yours(task, field.id));
      }
    }
  }

  render(width: number): string[] {
    const task = this.task();
    if (task != null) this.last = task;
    const lines =
      this.taskId === null
        ? [sgr(2, 'no task selected')]
        : task === undefined
          ? [sgr(2, 'loading…')]
          : task !== null
            ? this.rows(task, width)
            : this.open !== null && this.last !== undefined
              ? this.rows(this.last, width, 'this task was deleted')
              : ['this task is gone'];
    return lines.map((l) => truncateToWidth(l, width, '…', true));
  }

  /** The task as the refused write on `field` would make it. */
  private yours(task: TaskDetails, field: FieldId): TaskDetails | undefined {
    const refusal = this.refusals.get(keyOf(String(task.id), field));
    return refusal && { ...task, ...patchOf(refusal.draft) };
  }

  /** `head` stands in the title's place. */
  private rows(task: TaskDetails, width: number, head?: string): string[] {
    const statuses = this.deps.tui.topics.get('catalog')?.statuses;
    const shownFor = (t: TaskDetails) =>
      shownOf(t, statuses?.find((s) => s.id === t.column)?.name);
    const shown = shownFor(task);
    const cursor = (i: number, text: string) =>
      this.focused && this.open === null && i === this.at ? sgr(7, text) : text;
    // The cursor's last line: the pane scrolls to keep it in view.
    let end = 0;
    const lines = [head ?? sgr(1, shown.title)];
    FIELDS.forEach((f, i) => {
      if (this.open?.field === f.id) {
        const inner = this.open.component.render(Math.max(1, width - LABEL));
        inner.forEach((l, j) =>
          lines.push((j === 0 ? label(f.label) : ' '.repeat(LABEL)) + l),
        );
      } else {
        const saved = shown[f.id] || '—';
        const refusal = this.refusals.get(keyOf(String(task.id), f.id));
        const yours =
          refusal &&
          (shownFor({ ...task, ...patchOf(refusal.draft) })[f.id] || '—');
        // A refusal of what is saved anyway (a late answer) is not shown.
        lines.push(
          ...(refusal === undefined || yours === saved
            ? [label(f.label) + cursor(i, saved)]
            : [
                label(f.label) + cursor(i, `${sgr(31, '✗')} ${String(yours)}`),
                ' '.repeat(LABEL) +
                  sgr(2, `${saved} → ${String(yours)} · ${refusal.detail}`),
              ]),
        );
      }
      if (i === this.at) end = lines.length;
    });
    const subs = task.subtasks;
    if (subs.length > 0) {
      const done = subs.filter((s) => s.closed).length;
      lines.push('', sgr(2, `Subtasks ${String(done)}/${String(subs.length)}`));
      subs.forEach((s, j) => {
        lines.push(
          cursor(FIELDS.length + j, `${s.closed ? '[x]' : '[ ]'} ${s.title}`),
        );
        if (FIELDS.length + j === this.at) end = lines.length;
      });
    }
    if (this.height === undefined) return lines;
    const top = Math.max(0, end - this.height);
    return lines.slice(top, top + this.height);
  }

  invalidate(): void {}
}
