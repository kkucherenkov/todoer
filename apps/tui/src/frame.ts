import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import { sgr } from './style.js';

type Box = {
  width: number;
  height: number;
  title: string;
  active: boolean;
  color: boolean;
};

const ROUND = ['╭', '╮', '╰', '╯', '─', '│'] as const;
const DOUBLE = ['╔', '╗', '╚', '╝', '═', '║'] as const;

/**
 * `lines` in a box of exactly `width` × `height` cells, content cut or padded
 * to the inner `width - 2` × `height - 2`. The title sits in the top border.
 * Active: cyan with a bold title, or a double border under `NO_COLOR`;
 * inactive: dim.
 */
export function box(lines: string[], o: Box): string[] {
  const [tl, tr, bl, br, h, v] = o.active && !o.color ? DOUBLE : ROUND;
  const edge = (s: string) =>
    o.active && o.color ? sgr(36, s) : o.active ? s : sgr(2, s);
  const inner = Math.max(0, o.width - 2);
  // The ellipsis is added here so it stays inside the title's styling.
  const room = Math.max(0, o.width - 5);
  const cut = visibleWidth(o.title) > room;
  const title = !cut
    ? o.title
    : room > 0
      ? `${stripTerminalSequences(truncateToWidth(o.title, room - 1, ''))}…`
      : '';
  const head =
    title === ''
      ? edge(tl + h.repeat(inner) + tr)
      : edge(`${tl}${h} `) +
        (o.active ? `\u001b[1m${edge(title)}\u001b[22m` : edge(title)) +
        edge(` ${h.repeat(Math.max(0, inner - 3 - visibleWidth(title)))}${tr}`);
  const side = edge(v);
  return [
    head,
    ...Array.from(
      { length: Math.max(0, o.height - 2) },
      (_, i) => side + truncateToWidth(lines[i] ?? '', inner, '', true) + side,
    ),
    edge(bl + h.repeat(inner) + br),
  ];
}
