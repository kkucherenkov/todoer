import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readPassword } from './password.js';

const sink = () => {
  const out: string[] = [];
  return { out, write: (text: string) => out.push(text) };
};

describe('readPassword', () => {
  it('takes TODOER_PASSWORD without reading stdin', async () => {
    const stdin = new PassThrough();
    expect(await readPassword({ TODOER_PASSWORD: 'p w' }, stdin)).toBe('p w');
  });

  it('reads a pipe whole and strips exactly one trailing newline', async () => {
    const stdin = new PassThrough();
    stdin.end('a\nb\n\n');
    expect(await readPassword({}, stdin)).toBe('a\nb\n');
  });

  it('strips a CRLF line ending from a pipe', async () => {
    const stdin = new PassThrough();
    stdin.end('pw\r\n');
    expect(await readPassword({}, stdin)).toBe('pw');
  });

  it('reads a terminal in raw mode, honours backspace, restores the mode', async () => {
    const modes: boolean[] = [];
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: (mode: boolean) => modes.push(mode),
    });
    const stderr = sink();
    const pending = readPassword({}, stdin, stderr);
    stdin.write('abx\x7fc\r');
    expect(await pending).toBe('abc');
    expect(modes).toEqual([true, false]);
    expect(stderr.out.join('')).not.toContain('abc');
  });

  it('on a terminal, Ctrl-D ends the line and escape sequences are dropped', async () => {
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: () => undefined,
    });
    const pending = readPassword({}, stdin, sink());
    stdin.write('a\x1b[Ab\x04');
    expect(await pending).toBe('ab');
  });
});
