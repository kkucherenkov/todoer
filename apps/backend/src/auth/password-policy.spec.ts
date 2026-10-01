import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password-policy.js';

describe('passwordProblem', () => {
  it.each(['abc123!x', 'пароль1!', 'Long passphrase 9 words!'])(
    'accepts %j',
    (p) => {
      expect(passwordProblem(p)).toBeNull();
    },
  );
  it.each([
    ['ab1!', 'at least 8 characters'],
    ['abcdefgh', 'a digit'],
    ['abcdefg1', 'a symbol'],
    ['12345678!', 'a letter'],
  ])('refuses %j (%s)', (p, why) => {
    expect(passwordProblem(p)).toContain(why);
  });
});
