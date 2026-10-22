import { afterEach, describe, expect, it } from 'vitest';
import { createWrite } from './write.js';
import { renderApp } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

describe('renderApp', () => {
  it('cuts the frame to the rows and feeds keys to the root', async () => {
    const keys: string[] = [];
    const t = await renderApp({
      rows: 2,
      app: () => ({
        render: (width) => [`w${width}`, 'b', 'c'],
        invalidate: () => undefined,
        handleInput: (data) => void keys.push(data),
      }),
    });
    cleanup = t.cleanup;
    expect(t.frame()).toBe('w80\nb');
    t.resize(30, 3);
    expect(t.lines()).toEqual(['w30', 'b', 'c']);
    await t.press('a', 'b');
    expect(keys).toEqual(['a', 'b']);
  });

  it('settles a write through createWrite', async () => {
    const t = await renderApp();
    cleanup = t.cleanup;
    const write = createWrite(t);
    const result = await write((newId) => ({
      kind: 'add',
      opId: newId(),
      id: newId(),
      text: 'milk',
    }));
    await t.settle();
    expect(result.ok).toBe(true);
    expect(t.server.sent.length).toBeGreaterThan(0);
  });
});
