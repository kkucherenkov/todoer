import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import type { Pane } from './pi/app-shell.js';
import type { Topics$ } from './topics.js';

type Row = { key: string; name: string; count?: number };

const BUILT_IN: Record<string, string> = {
  all: 'All open',
  today: 'Today',
  upcoming: 'Upcoming',
};

const sgr = (code: number, text: string) => `\u001b[${code}m${text}\u001b[0m`;
const colour = () => (process.env.NO_COLOR ?? '') === '';

/**
 * The left column: built-in destinations, projects, tags and saved views.
 * Counts come from the core's `catalog.nav`; nothing is counted here.
 * `current` is the watched key (bold, cyan); the cursor is the `▸`.
 */
export class Sidebar implements Pane {
  /** The key the outline shows. */
  current = 'all';
  private at = 0;

  constructor(
    private readonly deps: {
      topics: Topics$;
      onPick: (key: string) => void;
    },
  ) {}

  private sections(): { title: string; rows: Row[] }[] {
    const catalog = this.deps.topics.get('catalog');
    const nav = catalog?.nav ?? [];
    const named = (items: { id: string; name: string }[], prefix: string) =>
      nav
        .filter((n) => n.key.startsWith(prefix))
        .map((n) => ({
          key: n.key,
          name: items.find((i) => prefix + i.id === n.key)?.name ?? n.key,
          count: n.count,
        }));
    const all = [
      {
        title: 'VIEWS',
        rows: nav
          .filter((n) => n.key in BUILT_IN)
          .map((n) => ({
            key: n.key,
            name: BUILT_IN[n.key] ?? n.key,
            count: n.count,
          })),
      },
      { title: 'PROJECTS', rows: named(catalog?.projects ?? [], 'project:') },
      { title: 'TAGS', rows: named(catalog?.tags ?? [], 'tag:') },
      {
        title: 'SAVED',
        rows: (catalog?.views ?? []).map((v) => ({ key: v.id, name: v.name })),
      },
    ];
    return all.filter((s) => s.rows.length > 0);
  }

  private clamp = (at: number, length: number) =>
    Math.max(0, Math.min(length - 1, at));

  private rows = (): Row[] => this.sections().flatMap((s) => s.rows);

  handleInput(data: string): void {
    const rows = this.rows();
    if (matchesKey(data, Key.enter)) {
      const row = rows[this.at];
      if (row !== undefined) this.deps.onPick(row.key);
    } else if (data === 'j' || matchesKey(data, Key.down)) {
      this.at = this.clamp(this.at + 1, rows.length);
    } else if (data === 'k' || matchesKey(data, Key.up)) {
      this.at = this.clamp(this.at - 1, rows.length);
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    let index = 0;
    this.at = this.clamp(this.at, this.rows().length);
    for (const { title, rows } of this.sections()) {
      if (lines.length > 0) lines.push('');
      lines.push(truncateToWidth(sgr(2, title), width, '', true));
      for (const row of rows) {
        const count = row.count === undefined ? '' : String(row.count);
        const name = truncateToWidth(
          row.name,
          Math.max(0, width - 3 - count.length),
          '…',
        );
        const gap = ' '.repeat(
          Math.max(0, width - 2 - visibleWidth(name) - count.length),
        );
        const text = `${name}${gap}${count}`;
        const styled =
          row.key === this.current
            ? sgr(1, colour() ? sgr(36, text) : text)
            : text;
        lines.push(`${index === this.at ? '▸' : ' '} ${styled}`);
        index += 1;
      }
    }
    return lines;
  }

  invalidate(): void {}
}
