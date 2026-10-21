import { describe, expect, it } from 'vitest';
import { exclusive } from './exclusive';

describe('exclusive', () => {
  it('drops a call made while one runs, then takes the next', async () => {
    let calls = 0;
    let finish = () => {};
    const { busy, run } = exclusive(() => {
      calls++;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    const first = run();
    await run(); // the double submit
    expect(calls).toBe(1);
    expect(busy.value).toBe(true);
    finish();
    await first;
    expect(busy.value).toBe(false);
    const next = run();
    finish();
    await next;
    expect(calls).toBe(2);
  });

  it('frees itself when the call throws', async () => {
    const { busy, run } = exclusive(() => Promise.reject(new Error('no')));
    await expect(run()).rejects.toThrow('no');
    expect(busy.value).toBe(false);
  });
});
