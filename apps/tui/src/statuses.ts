import {
  Key,
  matchesKey,
  truncateToWidth,
  type Input,
} from '@earendil-works/pi-tui';
import type { Pane } from './pi/app-shell.js';
import { sgr } from './style.js';
import type { Tui } from './tui.js';
import { confirmKeys } from './ui/confirm.js';
import { lineInput } from './ui/line-input.js';
import { createWrite } from './write.js';

/**
 * The statuses (the board's columns) in rank order: `a` add after the
 * cursor, Enter rename, `J`/`K` move, `c` completing, `dd` then `y` delete,
 * Esc or `q` back. Deleting leaves the status's tasks without one, which
 * shows them in the first status (views Q8). A screen: every key is its.
 */
export class Statuses implements Pane {
  readonly hints =
    'a add · Enter rename · J/K move · c completing · dd delete · Esc back';
  private at = 0;
  private input: Input | null = null;
  private deleting = false;
  // `dd`: the first `d` waits for a second; any other key forgets it.
  private pendingD = false;
  private readonly write: ReturnType<typeof createWrite>;

  constructor(
    private readonly deps: {
      tui: Pick<Tui, 'engine' | 'newId' | 'status' | 'topics'>;
      onClose: () => void;
    },
  ) {
    this.write = createWrite(deps.tui);
  }

  get inserting(): boolean {
    return this.input !== null;
  }

  private list = () => this.deps.tui.topics.get('catalog')?.statuses ?? [];

  private get k(): number {
    return Math.max(0, Math.min(this.at, this.list().length - 1));
  }

  /** Moves the cursor's status one place: after the status two above (or
   *  first), or after the next one. */
  private reorder(step: -1 | 1): void {
    const list = this.list();
    const { k } = this;
    const current = list[k];
    const target = k + step;
    if (current === undefined || target < 0 || target >= list.length) return;
    const after =
      step === -1 ? (list[k - 2]?.id ?? null) : (list[k + 1]?.id ?? null);
    void this.write((newId) => ({
      kind: 'saveStatus',
      opId: newId(),
      id: current.id,
      after,
    }));
    this.at = target;
  }

  private close = () => (this.input = null);

  handleInput(data: string): void {
    const { status } = this.deps.tui;
    if (this.input !== null) return this.input.handleInput(data);
    const list = this.list();
    const { k } = this;
    const current = list[k];
    if (this.deleting) {
      this.deleting = false;
      status.clear();
      if (confirmKeys(data) === 'yes' && current !== undefined) {
        void this.write((newId) => ({
          kind: 'deleteStatus',
          opId: newId(),
          id: current.id,
        }));
      }
      return;
    }
    if (data === 'd') {
      if (!this.pendingD) {
        this.pendingD = true;
        return;
      }
      this.pendingD = false;
      if (current === undefined) return;
      this.deleting = true;
      status.say({
        tone: 'info',
        text: `delete "${current.name}"? the ${current.tasks} task(s) shown in that column move to the first status · y/n`,
      });
      return;
    }
    this.pendingD = false;
    status.clear();
    if (matchesKey(data, Key.escape) || data === 'q') this.deps.onClose();
    else if (data === 'j' || matchesKey(data, Key.down)) {
      this.at = Math.min(list.length - 1, k + 1);
    } else if (data === 'k' || matchesKey(data, Key.up)) {
      this.at = Math.max(0, k - 1);
    } else if (data === 'a') {
      this.input = lineInput({
        label: 'new status:',
        onCancel: this.close,
        // Open until the write is taken: a refusal keeps the text.
        onSubmit: (name) =>
          void this.write((newId) => ({
            kind: 'saveStatus',
            opId: newId(),
            id: newId(),
            name,
            after: current?.id ?? null,
          })).then((r) => {
            if (!r.ok) return;
            this.close();
            this.at = k + 1;
          }),
      });
    } else if (current === undefined) return;
    else if (matchesKey(data, Key.enter)) {
      this.input = lineInput({
        label: 'rename:',
        initial: current.name,
        onCancel: this.close,
        onSubmit: (name) =>
          void this.write((newId) => ({
            kind: 'saveStatus',
            opId: newId(),
            id: current.id,
            name,
          })).then((r) => r.ok && this.close()),
      });
    } else if (data === 'J') this.reorder(1);
    else if (data === 'K') this.reorder(-1);
    else if (data === 'c') {
      void this.write((newId) => ({
        kind: 'setCompleting',
        opId: newId(),
        id: current.id,
      }));
    }
  }

  render(width: number): string[] {
    const list = this.list();
    const { k } = this;
    return [
      sgr(1, 'Statuses'),
      ...(list.length === 0 ? [sgr(2, 'none yet · a to add')] : []),
      ...list.map((s, i) => {
        const text = `${s.name}${s.completing ? ' ✓' : ''} (${s.tasks})`;
        return this.input === null && i === k ? sgr(7, text) : text;
      }),
      ...(this.input?.render(width) ?? []),
    ].map((l) => truncateToWidth(l, width, '…'));
  }

  invalidate(): void {}
}
