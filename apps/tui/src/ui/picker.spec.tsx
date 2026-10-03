import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { KEY } from '../test-kit.js';
import { Picker } from './picker.js';

// Past Ink's 20 ms wait for the rest of an escape sequence: a lone Esc
// reaches `useInput` only after it.
const tick = () => new Promise((r) => setTimeout(r, 50));

describe('Picker', () => {
  it('moves with j/k and arrows, picks with Enter', async () => {
    const onPick = vi.fn();
    const { stdin, lastFrame } = render(
      <Picker
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
          { id: 'c', label: 'Gamma' },
        ]}
        onPick={onPick}
        onCancel={() => {}}
      />,
    );
    expect(lastFrame()).toContain('› Alpha');
    stdin.write('j');
    await tick();
    stdin.write(KEY.down);
    await tick();
    expect(lastFrame()).toContain('› Gamma');
    stdin.write('k');
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onPick).toHaveBeenCalledWith('b');
  });

  it('starts on `initial` and cancels with Esc', async () => {
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      <Picker
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        initial="b"
        onPick={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(lastFrame()).toContain('› Beta');
    stdin.write(KEY.escape);
    await tick();
    expect(onCancel).toHaveBeenCalled();
  });
});
