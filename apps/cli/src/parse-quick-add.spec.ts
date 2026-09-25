import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './parse-quick-add.js';

describe('parseQuickAdd', () => {
  it('takes plain text as the title', () => {
    expect(parseQuickAdd('buy milk')).toEqual({
      title: 'buy milk', tags: [], project: undefined, priority: 0,
    });
  });

  it('extracts tags, a project and a priority', () => {
    expect(parseQuickAdd('call the bank @phone #finance p2')).toEqual({
      title: 'call the bank', tags: ['@phone'], project: 'finance', priority: 2,
    });
  });

  it('keeps an email address out of the tag list', () => {
    expect(parseQuickAdd('mail a@b.c about the invoice')).toEqual({
      title: 'mail a@b.c about the invoice',
      tags: [], project: undefined, priority: 0,
    });
  });

  it('leaves p5 in the title, since priorities stop at 4', () => {
    expect(parseQuickAdd('ship p5').title).toBe('ship p5');
  });
});
