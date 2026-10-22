import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from '@earendil-works/pi-tui';
import { sgr } from '../style.js';

export type PickerItem = { id: string; label: string };

/** A vertical choice: j/k or arrows move, Enter picks, Esc cancels. */
export class Picker implements Component {
  private at: number;

  constructor(
    private readonly deps: {
      items: PickerItem[];
      initial?: string;
      onPick: (id: string) => void;
      onCancel: () => void;
      title?: string;
    },
  ) {
    this.at = Math.max(
      0,
      deps.items.findIndex((i) => i.id === deps.initial),
    );
  }

  handleInput(data: string): void {
    const { items, onPick, onCancel } = this.deps;
    if (matchesKey(data, Key.escape)) onCancel();
    else if (matchesKey(data, Key.enter)) {
      const item = items[this.at];
      if (item !== undefined) onPick(item.id);
    } else if (data === 'j' || matchesKey(data, Key.down)) {
      this.at = Math.min(items.length - 1, this.at + 1);
    } else if (data === 'k' || matchesKey(data, Key.up)) {
      this.at = Math.max(0, this.at - 1);
    }
  }

  render(width: number): string[] {
    const { items, title } = this.deps;
    return [
      ...(title === undefined ? [] : [sgr(1, title)]),
      // A mark as well as inverse: inverse alone is lost without colour.
      ...items.map((item, i) =>
        i === this.at ? sgr(7, `› ${item.label}`) : `  ${item.label}`,
      ),
    ].map((l) => truncateToWidth(l, width, '…'));
  }

  invalidate(): void {}
}
