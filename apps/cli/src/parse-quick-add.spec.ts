import { describe, expect, it } from 'vitest';
import { parseQuickAdd, planAdd } from './parse-quick-add.js';
import { UsageError } from './protocol.js';

describe('parseQuickAdd', () => {
  it('takes plain text as the title', () => {
    expect(parseQuickAdd('buy milk')).toEqual({
      title: 'buy milk',
      tags: [],
      project: undefined,
      priority: 0,
    });
  });

  it('extracts tags, a project and a priority', () => {
    expect(parseQuickAdd('call the bank @phone #finance p2')).toEqual({
      title: 'call the bank',
      tags: ['@phone'],
      project: 'finance',
      priority: 2,
    });
  });

  it('keeps an email address out of the tag list', () => {
    expect(parseQuickAdd('mail a@b.c about the invoice')).toEqual({
      title: 'mail a@b.c about the invoice',
      tags: [],
      project: undefined,
      priority: 0,
    });
  });

  it('reads a name typed in decomposed form as a marker', () => {
    expect(parseQuickAdd('note @cafe\u0301 #re\u0301sume\u0301')).toEqual({
      title: 'note',
      tags: ['@cafe\u0301'],
      project: 're\u0301sume\u0301',
      priority: 0,
    });
  });

  it('leaves p5 in the title, since priorities stop at 4', () => {
    expect(parseQuickAdd('ship p5').title).toBe('ship p5');
  });
});

describe('planAdd', () => {
  it('carries the fields the ops are built from, markers included', () => {
    expect(planAdd('call the bank @phone #finance p2')).toEqual({
      title: 'call the bank',
      priority: 2,
      project: 'finance',
      tags: ['@phone'],
    });
  });

  it('has no project and no tags when none are given', () => {
    expect(planAdd('buy milk')).toEqual({
      title: 'buy milk',
      priority: 0,
      project: undefined,
      tags: [],
    });
  });

  it('refuses text whose every token was consumed by a marker', () => {
    expect(() => planAdd('#groceries')).toThrow(UsageError);
  });

  it('refuses an empty invocation', () => {
    expect(() => planAdd('   ')).toThrow(UsageError);
  });
});
