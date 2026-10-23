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
});
