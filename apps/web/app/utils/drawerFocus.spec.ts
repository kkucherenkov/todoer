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

const candidate = (taskId: string, element = target()) => ({
  taskId,
  target: element,
});

describe('drawer focus return', () => {
  it('returns focus to the connected opener', () => {
    const focus = createDrawerFocus<Target>();
    const opener = target();
    focus.remember(opener, [candidate('one', opener)], 'one');

    expect(focus.restore([], target())).toBe(opener);
    expect(opener.spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('uses the nearest remaining task when the opener disappeared', () => {
    const focus = createDrawerFocus<Target>();
    const first = target();
    const opener = target(false);
    const third = target();
    focus.remember(
      opener,
      [
        candidate('first', first),
        candidate('gone', opener),
        candidate('third', third),
      ],
      'gone',
    );

    expect(
      focus.restore(
        [candidate('first', first), candidate('third', third)],
        target(),
      ),
    ).toBe(third);
    expect(third.spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('returns to the task root when a portal menu item disappeared', () => {
    const focus = createDrawerFocus<Target>();
    const first = candidate('first');
    const second = candidate('second');
    const portalItem = target(false);
    focus.remember(portalItem, [first, second], 'second');

    expect(focus.restore([first, second], target())).toBe(second.target);
    expect(second.target.spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('falls back to the workspace heading and forgets the old opener', () => {
    const focus = createDrawerFocus<Target>();
    const opener = target(false);
    const heading = target();
    focus.remember(opener, [candidate('gone', opener)], 'gone');

    expect(focus.restore([], heading)).toBe(heading);
    expect(focus.restore([], undefined)).toBeUndefined();
  });
});
