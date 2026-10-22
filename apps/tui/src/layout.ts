import { truncateToWidth } from '@earendil-works/pi-tui';

export type Mode = 'three' | 'two' | 'one';

export const MIN = { columns: 60, rows: 12 };
const SIDEBAR = 24;
const DETAIL_MAX = 48;

export const modeFor = (columns: number): Mode =>
  columns >= 120 ? 'three' : columns >= 90 ? 'two' : 'one';

/** Column widths of a mode; `outline` is what is left after the gaps. */
export function widths(columns: number, mode: Mode) {
  const sidebar = mode === 'three' ? SIDEBAR : 0;
  const detail =
    mode === 'one' ? 0 : Math.min(DETAIL_MAX, Math.floor(columns * 0.35));
  const gaps = (sidebar > 0 ? 1 : 0) + (detail > 0 ? 1 : 0);
  return { sidebar, outline: columns - sidebar - detail - gaps, detail };
}

/** Zips the parts side by side, a space between, into exactly `rows` lines;
 *  each cell is cut or padded to its width, a missing line is blank. */
export function columns(
  parts: { lines: string[]; width: number }[],
  rows: number,
): string[] {
  return Array.from({ length: rows }, (_, i) =>
    parts
      .map((p) => truncateToWidth(p.lines[i] ?? '', p.width, '', true))
      .join(' '),
  );
}

export const tooSmall = (cols: number, rows: number): string[] | null =>
  cols < MIN.columns || rows < MIN.rows
    ? [`Terminal too small (need ${MIN.columns}×${MIN.rows})`]
    : null;
