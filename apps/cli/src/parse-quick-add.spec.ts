import { describe, expect, it } from 'vitest';
import { parseQuickAdd, planAdd } from './parse-quick-add.js';
import { UsageError } from './protocol.js';

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

describe('planAdd', () => {
  it('carries the fields the op is actually built from', () => {
    expect(planAdd('call the bank p2')).toEqual({
      title: 'call the bank', priority: 2, notice: null,
    });
  });

  it('refuses text whose every token was consumed by a marker', () => {
    expect(() => planAdd('#groceries')).toThrow(UsageError);
  });

  it('refuses an empty invocation', () => {
    expect(() => planAdd('   ')).toThrow(UsageError);
  });

  // Dropping them silently is how "buy milk #groceries @store" became a task
  // with neither, and exit 0.
  it('names the project and the tags it is not going to store', () => {
    const { notice } = planAdd('buy milk #groceries @store');
    expect(notice).toMatch(/#groceries/);
    expect(notice).toMatch(/@store/);
  });

  it('says nothing when there is nothing being dropped', () => {
    expect(planAdd('buy milk').notice).toBeNull();
  });
});
