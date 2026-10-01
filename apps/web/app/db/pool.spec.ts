import { describe, expect, it, vi } from 'vitest';
import { installPool } from './pool';

describe('installPool', () => {
  it('retries a busy pool with doubling delays until it installs', async () => {
    const install = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('NoModificationAllowedError'))
      .mockRejectedValueOnce(new Error('NoModificationAllowedError'))
      .mockResolvedValue('pool');
    const delays: number[] = [];
    const sleep = (ms: number) => (delays.push(ms), Promise.resolve());
    await expect(installPool(install, sleep)).resolves.toBe('pool');
    expect(install).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200]);
  });

  it('gives up after ten attempts, the last delays capped at 1 s', async () => {
    const install = vi.fn(() => Promise.reject(new Error('busy')));
    const delays: number[] = [];
    const sleep = (ms: number) => (delays.push(ms), Promise.resolve());
    await expect(installPool(install, sleep)).rejects.toThrow('busy');
    expect(install).toHaveBeenCalledTimes(10);
    expect(delays).toEqual([100, 200, 400, 800, 1000, 1000, 1000, 1000, 1000]);
  });

  it('fails fast when the browser has no OPFS at all', async () => {
    const install = vi.fn(() =>
      Promise.reject(new Error('Missing required OPFS APIs.')),
    );
    const sleep = vi.fn(() => Promise.resolve());
    await expect(installPool(install, sleep)).rejects.toThrow(
      'Missing required OPFS APIs.',
    );
    expect(install).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
