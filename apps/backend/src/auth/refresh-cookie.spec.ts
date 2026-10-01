import { describe, expect, it } from 'vitest';
import { readRefreshCookie } from './refresh-cookie.js';

describe('readRefreshCookie', () => {
  it('finds the value among other cookies', () => {
    expect(readRefreshCookie('a=1; todoer_refresh=tok.en-1; b=2')).toBe(
      'tok.en-1',
    );
  });

  it('is undefined without a header', () => {
    expect(readRefreshCookie(undefined)).toBeUndefined();
  });

  it('is undefined when only another cookie is present', () => {
    expect(readRefreshCookie('a=1; b=2')).toBeUndefined();
  });

  it('does not match a cookie whose name only starts with it', () => {
    expect(readRefreshCookie('todoer_refresh_x=1')).toBeUndefined();
  });

  it('gives undefined for an empty value', () => {
    expect(readRefreshCookie('todoer_refresh=')).toBeUndefined();
    expect(readRefreshCookie('todoer_refresh=  ')).toBeUndefined();
  });

  it('tolerates padding around ; and =', () => {
    expect(readRefreshCookie('a=1 ;  todoer_refresh = abc  ; b=2')).toBe('abc');
  });

  it('takes the first of two cookies with the name', () => {
    expect(readRefreshCookie('todoer_refresh=one; todoer_refresh=two')).toBe(
      'one',
    );
  });
});
