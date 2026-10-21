export const LAYOUTS = ['list', 'kanban', 'calendar'] as const;
export type Layout = (typeof LAYOUTS)[number];
export type LayoutKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export const isLayout = (value: unknown): value is Layout =>
  typeof value === 'string' && LAYOUTS.some((layout) => layout === value);

export const savedLayout = (value: unknown): Layout =>
  isLayout(value) ? value : 'list';

/** A key's saved layout: "All open" and a key the catalog lacks (not yet
 *  published, or deleted) are list, as the engine projects them. */
export const savedLayoutOf = (
  key: string | null,
  views: readonly { id: string; layout: string }[] | undefined,
): Layout => savedLayout(views?.find((view) => view.id === key)?.layout);

/** Resolves presentation only. It never changes the saved view: the engine
 *  projects any layout for any view (`watch.layout`). */
export function resolveLayout(query: unknown, savedValue: unknown) {
  const saved = savedLayout(savedValue);
  if (query === undefined) {
    return { layout: saved, normalize: false, override: undefined } as const;
  }
  if (!isLayout(query) || query === saved) {
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

export function nextLayout(current: Layout, key: LayoutKey): Layout {
  if (key === 'Home') return LAYOUTS[0];
  if (key === 'End') return LAYOUTS[LAYOUTS.length - 1]!;
  const step = key === 'ArrowRight' ? 1 : -1;
  const index = LAYOUTS.indexOf(current) + step + LAYOUTS.length;
  return LAYOUTS[index % LAYOUTS.length]!;
}
