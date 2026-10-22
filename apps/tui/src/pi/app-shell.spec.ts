import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@earendil-works/pi-tui';
import { createShell } from './app-shell.js';

function fakeTerminal() {
  const writes: string[] = [];
  const terminal: Terminal = {
    start: () => undefined,
    stop: () => undefined,
    drainInput: () => Promise.resolve(),
    write: (data) => void writes.push(data),
    columns: 40,
    rows: 10,
    kittyProtocolActive: false,
    moveBy: () => undefined,
    hideCursor: () => undefined,
    showCursor: () => undefined,
    clearLine: () => undefined,
    clearFromCursor: () => undefined,
    clearScreen: () => undefined,
    setTitle: () => undefined,
    setProgress: () => undefined,
    setProgramStatus: () => undefined,
  };
  return { terminal, writes };
}

const root = { render: () => ['hello'], invalidate: () => undefined };

describe('createShell', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stops on SIGTERM with the screen preserved', () => {
    const { terminal, writes } = fakeTerminal();
    const onExit = vi.fn();
    const shell = createShell({ terminal, root, onExit });
    shell.start();
    expect(writes.join('')).toContain('?1049h');
    process.emit('SIGTERM');
    expect(onExit).toHaveBeenCalledExactlyOnceWith(143);
    expect(writes.join('')).toContain('?1049l');

    shell.stop();
    expect(onExit).toHaveBeenCalledTimes(1);
    // preserveScreen: the last frame is not dumped into the scrollback
    expect(
      writes.join('').slice(writes.join('').indexOf('?1049l')),
    ).not.toContain('hello');
  });

  it('stops on SIGINT and removes its handlers', () => {
    const before = [
      process.listenerCount('SIGINT'),
      process.listenerCount('SIGTERM'),
    ];
    const { terminal } = fakeTerminal();
    const onExit = vi.fn();
    createShell({ terminal, root, onExit }).start();
    process.emit('SIGINT');
    expect(onExit).toHaveBeenCalledExactlyOnceWith(130);
    expect([
      process.listenerCount('SIGINT'),
      process.listenerCount('SIGTERM'),
    ]).toEqual(before);
  });

  it('leaves the alternate screen while suspended, then returns', () => {
    const { terminal, writes } = fakeTerminal();
    const shell = createShell({ terminal, root, onExit: () => undefined });
    shell.start();
    let during = '';
    shell.suspend(() => (during = writes.join('')));
    expect(during.lastIndexOf('?1049l')).toBeGreaterThan(
      during.lastIndexOf('?1049h'),
    );
    const after = writes.join('');
    expect(after.lastIndexOf('?1049h')).toBeGreaterThan(
      after.lastIndexOf('?1049l'),
    );
    shell.stop();
  });

  it('reports the terminal height as rows', () => {
    const { terminal } = fakeTerminal();
    const shell = createShell({ terminal, root, onExit: () => undefined });
    expect(shell.rows()).toBe(10);
  });
});
