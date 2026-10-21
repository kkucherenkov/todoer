export const LAYOUTS = ['list', 'kanban', 'calendar'] as const;
export type Layout = (typeof LAYOUTS)[number];
export type LayoutKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export const isLayout = (value: unknown): value is Layout =>
  typeof value === 'string' && LAYOUTS.some((layout) => layout === value);

export const savedLayout = (value: unknown): Layout =>
  isLayout(value) ? value : 'list';

export const layoutAvailable = (layout: Layout, saved: Layout) =>
  saved === 'calendar' ? layout === 'calendar' : layout !== 'calendar';

/** Resolves presentation only. It never changes the saved view. Calendar is
 * available transiently once core C1 can project the requested layout. */
export function resolveLayout(query: unknown, savedValue: unknown) {
  const saved = savedLayout(savedValue);
  if (query === undefined) {
    return { layout: saved, normalize: false, override: undefined } as const;
  }
  if (!isLayout(query) || !layoutAvailable(query, saved) || query === saved) {
    return { layout: saved, normalize: true, override: undefined } as const;
  }
  return { layout: query, normalize: false, override: query } as const;
}

export type Query = Readonly<Record<string, unknown>>;

export const layoutQuery = <Q extends Query>(
  query: Q,
  saved: Layout,
  next: Layout,
) => ({
  ...query,
  layout: next === saved ? undefined : next,
});

/** A new view has its own default presentation; every other piece of context
 * remains in the URL, including an open task and calendar navigation. */
export const viewQuery = <Q extends Query>(query: Q) => ({
  ...query,
  layout: undefined,
});

export function nextLayout(
  current: Layout,
  key: LayoutKey,
  saved: Layout,
): Layout {
  const modes = LAYOUTS.filter((layout) => layoutAvailable(layout, saved));
  if (key === 'Home') return modes[0]!;
  if (key === 'End') return modes.at(-1)!;
  const index = Math.max(0, modes.indexOf(current));
  const step = key === 'ArrowRight' ? 1 : -1;
  return modes[(index + step + modes.length) % modes.length]!;
}
