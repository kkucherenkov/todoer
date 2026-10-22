import { describe, expect, it } from 'vitest';
import { Input } from '@earendil-works/pi-tui';
import { setInputValue } from './adapter.js';

describe('setInputValue', () => {
  it('puts the cursor at the end', () => {
    const input = new Input();
    setInputValue(input, 'abc');
    input.handleInput('x');
    expect(input.getValue()).toBe('abcx');
  });
});
