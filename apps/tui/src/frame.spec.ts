import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { box } from './frame.js';

const o = { width: 20, height: 5, title: 'Tasks', active: false, color: true };
const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

describe('box', () => {
  it('returns height lines of exactly width cells, title in the top border', () => {
    const out = box(['one', 'two'], o);
    expect(out).toHaveLength(5);
    for (const line of out) expect(visibleWidth(line)).toBe(20);
    expect(plain(out[0] ?? '')).toBe('╭─ Tasks ──────────╮');
    expect(plain(out[1] ?? '')).toBe('│one               │');
    expect(plain(out[2] ?? '')).toBe('│two               │');
    expect(plain(out[3] ?? '')).toBe('│                  │');
    expect(plain(out[4] ?? '')).toBe('╰──────────────────╯');
  });

  it('cuts content to the inner area', () => {
    const out = box(['x'.repeat(40), 'b', 'c', 'd', 'e'], o);
    expect(out).toHaveLength(5);
    expect(plain(out[1] ?? '')).toBe(`│${'x'.repeat(18)}│`);
    expect(plain(out[3] ?? '')).toBe('│c                 │');
  });

  it('cuts a narrow title with an ellipsis', () => {
    const out = box([], { ...o, width: 8 });
    expect(plain(out[0] ?? '')).toBe('╭─ Ta… ╮');
    expect(visibleWidth(out[0] ?? '')).toBe(8);
  });

  it.each([['Разобрать'], ['買い物'], ['👍🏽 done']])(
    'keeps the exact width for %s',
    (text) => {
      for (const width of [8, 11, 20]) {
        for (const line of box([text, text], { ...o, width })) {
          expect(visibleWidth(line)).toBe(width);
        }
      }
    },
  );

  it('draws the active pane cyan, the inactive one dim', () => {
    expect(box([], { ...o, active: true }).join('')).toContain(`${ESC}[36m`);
    expect(box([], o).join('')).not.toContain(`${ESC}[36m`);
    expect(box([], o)[0]).toContain(`${ESC}[2m`);
  });

  it('without colour the active pane has a double border and no colour code', () => {
    const active = box(['a'], { ...o, active: true, color: false });
    expect(plain(active[0] ?? '')).toMatch(/^╔═ Tasks ═+╗$/);
    expect(plain(active[1] ?? '')).toMatch(/^║a +║$/);
    expect(plain(active[4] ?? '')).toMatch(/^╚═+╝$/);
    expect(plain(box([], { ...o, color: false })[0] ?? '')).toMatch(/^╭/);
    for (const active of [true, false]) {
      expect(box(['a'], { ...o, active, color: false }).join('')).not.toContain(
        `${ESC}[3`,
      );
    }
  });

  it('closes the bold right after the title, also without colour', () => {
    for (const color of [true, false]) {
      const head = box([], { ...o, active: true, color })[0] ?? '';
      const bold = head.indexOf(`${ESC}[1m`);
      expect(bold).toBeGreaterThan(-1);
      const shut = head.indexOf(`${ESC}[22m`, bold);
      expect(shut).toBeGreaterThan(bold);
      // Closed before the next border character.
      expect(plain(head.slice(0, shut))).toMatch(/^[╭╔][─═] Tasks$/);
    }
  });

  it("keeps a cut title's ellipsis inside the title styling", () => {
    const head = box([], { ...o, width: 8, active: true })[0] ?? '';
    expect(head).toContain('Ta…');
    expect(head.indexOf('…')).toBeLessThan(
      head.indexOf(`${ESC}[0m`, head.indexOf('Ta')),
    );
  });
});
