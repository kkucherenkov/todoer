import { describe, expect, it, vi } from 'vitest';
import { createDrawerFocus } from './drawerFocus';

type Target = {
  isConnected: boolean;
  focus(options?: FocusOptions): void;
  spy: ReturnType<typeof vi.fn<(options?: FocusOptions) => void>>;
};

const target = (isConnected = true): Target => {
  const spy = vi.fn<(options?: FocusOptions) => void>();
  return { isConnected, focus: (options) => spy(options), spy };
};

describe('drawer focus return', () => {
  it('returns focus to the connected opener', () => {
    const focus = createDrawerFocus<Target>();
    const opener = target();
    focus.remember(opener, [opener]);

    expect(focus.restore([], target())).toBe(opener);
    expect(opener.spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('uses the nearest remaining task when the opener disappeared', () => {
    const focus = createDrawerFocus<Target>();
    const first = target();
    const opener = target(false);
    const third = target();
    focus.remember(opener, [first, opener, third]);

    expect(focus.restore([first, third], target())).toBe(third);
    expect(third.spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('falls back to the workspace heading and forgets the old opener', () => {
    const focus = createDrawerFocus<Target>();
    const opener = target(false);
    const heading = target();
    focus.remember(opener, [opener]);

    expect(focus.restore([], heading)).toBe(heading);
    expect(focus.restore([], undefined)).toBeUndefined();
  });
});
