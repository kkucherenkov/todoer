import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from '@earendil-works/pi-tui';
import {
  ALL,
  type Result,
  type Rule,
  type TaskChanges,
  type TaskDetails,
} from '@todoer/client-core';
import { editText } from './editor.js';
import {
  customRule,
  describeRule,
  parseDate,
  parsePriority,
  parseTags,
  presets,
} from './fields.js';
import type { Pane } from './pi/app-shell.js';
import { sgr } from './style.js';
import type { Tui } from './tui.js';
import { lineInput } from './ui/line-input.js';
import { Picker } from './ui/picker.js';
import { statusPicker } from './ui/status-picker.js';
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

const dateOf = (value: unknown) => (typeof value === 'string' ? value : '');
const priorityOf = (task: TaskDetails) => {
  const p = Number(task.priority ?? 4);
  return p < 4 ? `p${String(p)}` : '';
};
const linesOf = (text: string) => {
  const n = text.split('\n').length;
  return n === 1 ? '1 line' : `${String(n)} lines`;
};

/** What each row shows; '' reads as "—". */
function shownOf(
  task: TaskDetails,
  statusName: string | undefined,
): Record<FieldId, string> {
  const enter = 'Enter opens $EDITOR';
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
    notes:
      task.notes === null
        ? `— · ${enter}`
        : `${linesOf(task.notes)} · ${enter}`,
  };
}

/**
 * The selected task's fields in the detail column, one row each. Focused,
 * j/k move and Enter edits the row: a line under the fields, a picker for
 * the status and the repeat, `$VISUAL` for the notes. Every field saves on
 * its own, as one write. PR 2 turns these rows into in-place editors.
 */
export class Details implements Pane {
  private taskId: string | null = null;
  private at = 0;
  private focused = false;
  /** The line or the picker editing a field; it takes every key. */
  private open: Component | null = null;
  private readonly write: ReturnType<typeof createWrite>;

  constructor(
    private readonly deps: {
      tui: Pick<Tui, 'engine' | 'newId' | 'status' | 'topics' | 'today'>;
      /** Runs `run` with the terminal given back, for `$EDITOR`. */
      suspend?: (run: () => void) => void;
    },
  ) {
    this.write = createWrite(deps.tui);
  }

  show(taskId: string | null): void {
    if (taskId !== this.taskId) this.open = null;
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
    return this.open instanceof Input;
  }

  private task(): TaskDetails | null | undefined {
    return this.taskId === null
      ? null
      : this.deps.tui.topics.task(this.taskId)?.task;
  }

  private close = () => (this.open = null);

  private edit(taskId: string, changes: TaskChanges) {
    return this.write((newId) => ({
      kind: 'edit',
      opId: newId(),
      taskId,
      changes,
    }));
  }

  private setRule(taskId: string, rule: Rule | null) {
    return this.write((newId) => ({
      kind: 'setRule',
      opId: newId(),
      taskId,
      rule,
    }));
  }

  /** A line that saves through `save`: a string back is the refusal, said
   *  on the status line. Open until the write is taken, so a refusal of
   *  either kind keeps the text. */
  private line(
    label: string,
    initial: string,
    save: (text: string) => Promise<Result> | string,
  ): void {
    this.open = lineInput({
      label: `${label}:`,
      initial,
      onCancel: this.close,
      onSubmit: (text) => {
        const saved = save(text);
        if (typeof saved === 'string') {
          this.deps.tui.status.say({ tone: 'error', text: saved });
        } else {
          void saved.then((r) => r.ok && this.close());
        }
      },
    });
  }

  private openField(task: TaskDetails, id: FieldId): void {
    const { tui } = this.deps;
    const taskId = String(task.id);
    const shown = shownOf(task, undefined);
    const dtstart =
      task.dtstart ??
      (typeof task.scheduledOn === 'string' ? task.scheduledOn : tui.today());
    const date = (field: 'scheduledOn' | 'dueOn', label: string) =>
      this.line(label, shown[field], (text) => {
        const value = parseDate(text);
        if (value === false) return 'a date is YYYY-MM-DD; empty clears it';
        return this.edit(
          taskId,
          field === 'dueOn' ? { dueOn: value } : { scheduledOn: value },
        );
      });
    switch (id) {
      case 'title':
        return this.line('Title', shown.title, (title) =>
          this.edit(taskId, { title }),
        );
      case 'project':
        return this.line('Project', shown.project, (text) => {
          const name = text.trim().replace(/^#/, '');
          return this.edit(taskId, { project: name === '' ? null : name });
        });
      case 'tags':
        return this.line('Tags', shown.tags, (text) =>
          this.edit(taskId, { tags: parseTags(text) }),
        );
      case 'priority':
        return this.line('Priority', shown.priority, (text) => {
          const priority = parsePriority(text);
          return priority === 'invalid'
            ? 'priority is p0 to p4'
            : this.edit(taskId, { priority });
        });
      case 'status':
        this.open = statusPicker({
          ...tui,
          write: this.write,
          taskId,
          current: task.column,
          view: ALL,
          onDone: this.close,
        });
        return;
      case 'scheduledOn':
        return date('scheduledOn', 'Scheduled');
      case 'dueOn':
        return date('dueOn', 'Due');
      case 'repeat': {
        if (typeof task.parentId === 'string') {
          tui.status.say({
            tone: 'info',
            text: 'a subtask repeats with its parent',
          });
          return;
        }
        const choices = presets(dtstart);
        this.open = new Picker({
          title: 'Repeat',
          items: [
            ...choices.map((p) => ({ id: p.id, label: p.label })),
            { id: 'custom', label: 'custom RRULE…' },
          ],
          onCancel: this.close,
          onPick: (pick) => {
            if (pick === 'custom') {
              return this.line('RRULE', task.rrule ?? '', (text) => {
                const rule = customRule(text, dtstart);
                return typeof rule === 'string'
                  ? rule
                  : this.setRule(taskId, rule);
              });
            }
            const preset = choices.find((p) => p.id === pick);
            // The picker has no text to keep: it closes either way.
            this.close();
            if (preset !== undefined) {
              void this.setRule(taskId, preset.rule(dtstart));
            }
          },
        });
        return;
      }
      case 'notes': {
        const run = this.deps.suspend ?? ((f: () => void) => f());
        let next: string | null = null;
        run(() => (next = editText(task.notes ?? '', process.env)));
        if (next !== null) void this.edit(taskId, { notes: next });
      }
    }
  }

  handleInput(data: string): void {
    if (this.open !== null) {
      this.open.handleInput?.(data);
      return;
    }
    this.deps.tui.status.clear();
    if (data === 'j' || matchesKey(data, Key.down)) {
      this.at = Math.min(FIELDS.length - 1, this.at + 1);
    } else if (data === 'k' || matchesKey(data, Key.up)) {
      this.at = Math.max(0, this.at - 1);
    } else if (matchesKey(data, Key.enter)) {
      const task = this.task();
      const field = FIELDS[this.at];
      if (task != null && field !== undefined) this.openField(task, field.id);
    }
  }

  render(width: number): string[] {
    const task = this.task();
    const lines =
      this.taskId === null
        ? [sgr(2, 'no task selected')]
        : task === undefined
          ? [sgr(2, 'loading…')]
          : task === null
            ? ['this task is gone']
            : this.fields(task, width);
    return lines.map((l) => truncateToWidth(l, width, '…'));
  }

  private fields(task: TaskDetails, width: number): string[] {
    const name = this.deps.tui.topics
      .get('catalog')
      ?.statuses.find((s) => s.id === task.column)?.name;
    const shown = shownOf(task, name);
    const cursor = this.focused && this.open === null;
    return [
      sgr(1, shown.title),
      ...FIELDS.map((f, i) => {
        const value = shown[f.id] || '—';
        return `${sgr(2, f.label.padEnd(10))} ${cursor && i === this.at ? sgr(7, value) : value}`;
      }),
      ...(task.subtasks.length === 0
        ? []
        : [
            '',
            sgr(2, 'Subtasks'),
            ...task.subtasks.map((s) => `${s.closed ? '✓' : '·'} ${s.title}`),
          ]),
      ...(this.open?.render(width) ?? []),
    ];
  }

  invalidate(): void {}
}
