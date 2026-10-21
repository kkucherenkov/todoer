export type FocusTarget = {
  isConnected: boolean;
  focus(options?: FocusOptions): void;
};

export type FocusCandidate<T extends FocusTarget> = {
  target: T;
  taskId: string;
};

/** Keeps no DOM tree alive: callers supply the current task controls again
 * when restoring, so a removed opener falls through to its former position. */
export function createDrawerFocus<T extends FocusTarget>() {
  let opener: T | undefined;
  let taskId: string | undefined;
  let index = 0;

  return {
    remember(
      target: T | undefined,
      candidates: readonly FocusCandidate<T>[],
      openedTaskId: string,
    ) {
      opener = target;
      taskId = openedTaskId;
      const found = candidates.findIndex(
        (candidate) =>
          candidate.target === target || candidate.taskId === openedTaskId,
      );
      index = found < 0 ? 0 : found;
    },
    restore(candidates: readonly FocusCandidate<T>[], fallback?: T) {
      const target =
        (opener?.isConnected ? opener : undefined) ??
        candidates.find((candidate) => candidate.taskId === taskId)?.target ??
        candidates[Math.min(index, Math.max(0, candidates.length - 1))]
          ?.target ??
        fallback;
      opener = undefined;
      taskId = undefined;
      index = 0;
      target?.focus({ preventScroll: true });
      return target;
    },
  };
}

const drawerFocus = createDrawerFocus<HTMLElement>();
const openers = () =>
  [...document.querySelectorAll<HTMLElement>('[data-task-opener]')].flatMap(
    (target) => {
      const taskId =
        target.closest<HTMLElement>('[data-task-id]')?.dataset.taskId;
      return taskId ? [{ target, taskId }] : [];
    },
  );

export function rememberDrawerFocus(taskId: string, target?: HTMLElement) {
  drawerFocus.remember(target, openers(), taskId);
}

export function restoreDrawerFocus() {
  return drawerFocus.restore(
    openers(),
    document.querySelector<HTMLElement>('[data-workspace-heading]') ??
      undefined,
  );
}
