import { describe, expect, it, vi } from 'vitest';
import { reloadOntoNewBuild } from './newBuild';

/** A registration whose `update` finds `found`, a worker that installs. */
function registration(found: 'new' | 'none' | 'offline') {
  const worker = Object.assign(new EventTarget(), {
    state: 'installing',
  });
  const reg = {
    installing: null as typeof worker | null,
    waiting: null as typeof worker | null,
    update: vi.fn(() => {
      if (found === 'offline') return Promise.reject(new TypeError('offline'));
      if (found === 'new') {
        reg.installing = worker;
        setTimeout(() => {
          worker.state = 'installed';
          reg.installing = null;
          reg.waiting = worker;
          worker.dispatchEvent(new Event('statechange'));
        });
      }
      return Promise.resolve();
    }),
  };
  return reg;
}

const container = (reg: unknown, controlled = true) =>
  ({
    controller: controlled ? {} : null,
    getRegistration: () => Promise.resolve(reg),
  }) as unknown as ServiceWorkerContainer;

describe('reloadOntoNewBuild', () => {
  it('installs the new worker and activates it instead of reloading', async () => {
    const reg = registration('new');
    const activate = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    await reloadOntoNewBuild(container(reg), activate, reload);
    expect(reg.update).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when the server has no new worker', async () => {
    const activate = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    await reloadOntoNewBuild(container(registration('none')), activate, reload);
    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads when the update check fails', async () => {
    const activate = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    const reg = registration('offline');
    await reloadOntoNewBuild(container(reg), activate, reload);
    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads when the registration lookup fails', async () => {
    const activate = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    const broken = {
      controller: {},
      getRegistration: () => Promise.reject(new Error('invalid state')),
    } as unknown as ServiceWorkerContainer;
    await reloadOntoNewBuild(broken, activate, reload);
    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads a page no worker controls', async () => {
    const reg = registration('new');
    const reload = vi.fn();
    await reloadOntoNewBuild(container(reg, false), vi.fn(), reload);
    await reloadOntoNewBuild(undefined, vi.fn(), reload);
    expect(reg.update).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
