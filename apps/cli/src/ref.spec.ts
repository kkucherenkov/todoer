import { describe, expect, it } from 'vitest';
import { UsageError } from '@todoer/client-core';
import { resolveRef, shortRef } from './ref.js';

const a = { id: '0192a1b2-0000-7000-8000-000000a00111', title: 'first' };
const b = { id: '0192a1b2-0000-7000-8000-000000b00111', title: 'second' };
const tasks = [a, b];

describe('shortRef', () => {
  it('is the last six characters of the id', () => {
    expect(shortRef(a.id)).toBe('a00111');
  });
});

describe('resolveRef', () => {
  it('finds a task by its full id, case-insensitively', () => {
    expect(resolveRef(tasks, a.id.toUpperCase())).toBe(a);
  });

  it('finds a task by a unique suffix', () => {
    expect(resolveRef(tasks, 'a00111')).toBe(a);
    expect(resolveRef(tasks, 'b00111')).toBe(b);
  });

  it('refuses an ambiguous suffix and names the candidates', () => {
    expect(() => resolveRef(tasks, '0111')).toThrow(UsageError);
    expect(() => resolveRef(tasks, '0111')).toThrow(
      /a00111 first; b00111 second/,
    );
  });

  it('refuses a suffix that matches nothing', () => {
    expect(() => resolveRef(tasks, 'ffff')).toThrow('no task matches ffff');
  });

  it.each(['1', 'id-2', 'zzzz', '', '111'])(
    'refuses %j as a reference',
    (ref) => {
      expect(() => resolveRef(tasks, ref)).toThrow(/at least 4 hex digits/);
    },
  );
});
