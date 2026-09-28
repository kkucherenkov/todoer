import { describe, expect, it } from 'vitest';
import { UsageError } from './protocol.js';
import { resolveRef, shortRef } from './ref.js';

const a = { id: '0192a1b2-0000-7000-8000-00000a0111', title: 'first' };
const b = { id: '0192a1b2-0000-7000-8000-00000b0111', title: 'second' };
const tasks = [a, b];

describe('shortRef', () => {
  it('is the last six characters of the id', () => {
    expect(shortRef(a.id)).toBe('0a0111');
  });
});

describe('resolveRef', () => {
  it('finds a task by its full id, case-insensitively', () => {
    expect(resolveRef(tasks, a.id.toUpperCase())).toBe(a);
  });

  it('finds a task by a unique suffix', () => {
    expect(resolveRef(tasks, 'a0111')).toBe(a);
    expect(resolveRef(tasks, '0b0111')).toBe(b);
  });

  it('refuses an ambiguous suffix and names the candidates', () => {
    expect(() => resolveRef(tasks, '0111')).toThrow(UsageError);
    expect(() => resolveRef(tasks, '0111')).toThrow(
      /0a0111 first.*0b0111 second/,
    );
  });

  it('refuses a suffix that matches nothing', () => {
    expect(() => resolveRef(tasks, 'ffff')).toThrow('no task matches ffff');
  });

  it.each(['1', 'id-2', 'zzzz', ''])('refuses %j as a reference', (ref) => {
    expect(() => resolveRef(tasks, ref)).toThrow(/at least 4 hex digits/);
  });
});
