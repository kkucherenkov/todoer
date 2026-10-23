import { describe, expect, it, vi } from 'vitest';
import { ChangeFeed } from './change-feed.js';

describe('ChangeFeed', () => {
  it('calls a listener once per announce for its user', () => {
    const feed = new ChangeFeed();
    const fn = vi.fn();
    feed.listen('u1', fn);
    feed.announce('u1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not call a listener for another user', () => {
    const feed = new ChangeFeed();
    const fn = vi.fn();
    feed.listen('u1', fn);
    feed.announce('u2');
    expect(fn).not.toHaveBeenCalled();
  });

  it('stops after the returned function is called', () => {
    const feed = new ChangeFeed();
    const fn = vi.fn();
    feed.listen('u1', fn)();
    feed.announce('u1');
    expect(fn).not.toHaveBeenCalled();
  });

  it('survives a throwing listener and still calls the others', () => {
    const feed = new ChangeFeed();
    const second = vi.fn();
    feed.listen('u1', () => {
      throw new Error('boom');
    });
    feed.listen('u1', second);
    expect(() => feed.announce('u1')).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('forgets a user once the last listener is gone', () => {
    const feed = new ChangeFeed();
    feed.listen('u1', vi.fn())();
    expect(feed['listeners'].has('u1')).toBe(false);
  });
});
