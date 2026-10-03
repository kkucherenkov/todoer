import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editText } from './editor.js';

describe('editText', () => {
  it('returns what the editor left in the file', () => {
    const out = editText('old', { EDITOR: 'fake' }, (cmd, file) => {
      expect(cmd).toBe('fake');
      expect(readFileSync(file, 'utf8')).toBe('old');
      writeFileSync(file, 'new\n');
      return 0;
    });
    expect(out).toBe('new');
  });

  it('is null when nothing changed or the editor failed', () => {
    expect(editText('same', {}, () => 0)).toBeNull();
    expect(
      editText('x', {}, (_cmd, file) => (writeFileSync(file, 'y'), 1)),
    ).toBeNull();
  });

  it('prefers $VISUAL, falls back to vi', () => {
    let used = '';
    const spy = (cmd: string) => ((used = cmd), 0);
    editText('x', { VISUAL: 'v', EDITOR: 'e' }, spy);
    expect(used).toBe('v');
    editText('x', {}, spy);
    expect(used).toBe('vi');
  });
});
