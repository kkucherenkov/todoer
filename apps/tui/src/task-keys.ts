import { Input, Key, matchesKey, type Component } from '@earendil-works/pi-tui';
import type { Item } from '@todoer/client-core';
import { lineChanges, lineOf } from './line.js';
import type { Tui } from './tui.js';
import { confirmKeys } from './ui/confirm.js';
import { lineInput } from './ui/line-input.js';
import { statusPicker } from './ui/status-picker.js';
import type { createWrite } from './write.js';

/**
 * The task keys the outline and the board share: `x`/Space done or undo,
 * `s` skip, `dd` then `y` delete, `m` status, Enter/`i` edit the line in
 * place. A pane calls `handle` first and stops when it returns true; it
 * draws `render` (the editor or the picker) under its rows.
 */
export class TaskKeys {
  private pendingD = false;
  private deleting = false;
  /** The line editor or the status picker; it takes every key. */
  private open: Component | null = null;

  constructor(
    private readonly deps: {
      tui: Pick<Tui, 'topics' | 'status'>;
      write: ReturnType<typeof createWrite>;
    },
  ) {}

  /** The next key is this one's: a `d` waits, a question or an editor. */
  get holding(): boolean {
    return this.open !== null || this.pendingD || this.deleting;
  }

  /** A line is being typed. */
  get inserting(): boolean {
    return this.open instanceof Input;
  }

  private close = () => (this.open = null);

  /** True when `data` was one of the keys; `view` is where a move happens. */
  handle(data: string, item: Item | undefined, view: string): boolean {
    const { tui, write } = this.deps;
    if (this.open !== null) {
      this.open.handleInput?.(data);
      return true;
    }
    if (this.deleting) {
      this.deleting = false;
      tui.status.clear();
      if (confirmKeys(data) === 'yes' && item !== undefined) {
        void write((newId) => ({
          kind: 'deleteTask',
          opId: newId(),
          taskId: String(item.id),
        }));
      }
      return true;
    }
    if (item === undefined) return false;
    const taskId = String(item.id);
    if (data === 'd') {
      if (!this.pendingD) {
        this.pendingD = true;
        return true;
      }
      this.pendingD = false;
      this.deleting = true;
      tui.status.say({
        tone: 'info',
        text: `delete "${String(item.title)}"? y/n`,
      });
      return true;
    }
    this.pendingD = false;
    if (data === 'x' || data === ' ' || data === 's') {
      void write((newId) => ({
        kind: 'mark',
        opId: newId(),
        taskId,
        mark: data === 's' ? 'skip' : item.closed ? 'undo' : 'done',
      }));
    } else if (data === 'm') {
      this.open = statusPicker({
        ...tui,
        write,
        taskId,
        current: item.column,
        view,
        onDone: this.close,
      });
    } else if (data === 'i' || matchesKey(data, Key.enter)) {
      this.open = lineInput({
        label: 'edit:',
        initial: lineOf(item),
        onCancel: this.close,
        onSubmit: (line) => {
          const changes = lineChanges(item, line);
          if (Object.keys(changes).length === 0) return this.close();
          // Open until the write is taken: a refusal keeps the text.
          void write((newId) => ({
            kind: 'edit',
            opId: newId(),
            taskId,
            changes,
          })).then((r) => r.ok && this.close());
        },
      });
    } else return false;
    return true;
  }

  render(width: number): string[] {
    return this.open?.render(width) ?? [];
  }
}
