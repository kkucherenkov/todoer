export type FocusTarget = {
  isConnected: boolean;
  focus(options?: FocusOptions): void;
};

/** Keeps no DOM tree alive: callers supply the current task controls again
 * when restoring, so a removed opener falls through to its former position. */
export function createDrawerFocus<T extends FocusTarget>() {
  let opener: T | undefined;
  let index = 0;

  return {
    remember(target: T | undefined, candidates: readonly T[]) {
      opener = target;
      const found = target ? candidates.indexOf(target) : -1;
      index = found < 0 ? 0 : found;
    },
    restore(candidates: readonly T[], fallback?: T) {
      const target =
        (opener?.isConnected ? opener : undefined) ??
        candidates[Math.min(index, Math.max(0, candidates.length - 1))] ??
        fallback;
      opener = undefined;
      index = 0;
      target?.focus({ preventScroll: true });
      return target;
    },
  };
}

const drawerFocus = createDrawerFocus<HTMLElement>();
const openers = () => [
  ...document.querySelectorAll<HTMLElement>('[data-task-opener]'),
];

export function rememberDrawerFocus(target?: HTMLElement) {
  drawerFocus.remember(target, openers());
}

export function restoreDrawerFocus() {
  return drawerFocus.restore(
    openers(),
    document.querySelector<HTMLElement>('[data-workspace-heading]') ??
      undefined,
  );
}
