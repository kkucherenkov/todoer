import { describe, expect, it, vi } from 'vitest';
import { KEY } from '../test-kit.js';
import { Picker } from './picker.js';

const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
const frame = (p: Picker) => p.render(40).map(plain).join('\n');

describe('Picker', () => {
  it('moves with j/k and arrows, picks with Enter', () => {
    const onPick = vi.fn();
    const p = new Picker({
      items: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
        { id: 'c', label: 'Gamma' },
      ],
      onPick,
      onCancel: () => {},
    });
    expect(frame(p)).toContain('› Alpha');
    p.handleInput('j');
    p.handleInput(KEY.down);
    expect(frame(p)).toContain('› Gamma');
    p.handleInput('k');
    p.handleInput(KEY.enter);
    expect(onPick).toHaveBeenCalledWith('b');
  });

  it('starts on `initial` and cancels with Esc', () => {
    const onCancel = vi.fn();
    const p = new Picker({
      items: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ],
      initial: 'b',
      onPick: () => {},
      onCancel,
    });
    expect(frame(p)).toContain('› Beta');
    p.handleInput(KEY.escape);
    expect(onCancel).toHaveBeenCalled();
  });
});
