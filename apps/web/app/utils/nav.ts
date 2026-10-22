import {
  ALL,
  PROJECT_PREFIX,
  TAG_PREFIX,
  TODAY,
  UPCOMING,
  type Catalog,
} from '@todoer/client-core';

/** A built-in destination of the navigation; `name`: a project's, null for
 *  the built-ins the screen labels itself. The count is the core's. */
export type NavEntry = {
  key: string;
  count: number;
  path: string;
  name: string | null;
};

const PATHS: Record<string, string> = {
  [ALL]: '/',
  [TODAY]: '/today',
  [UPCOMING]: '/upcoming',
};

/** The route of a watch key: a built-in, `project:<id>`, `tag:<id>` or a
 *  saved view id. */
export const navPath = (key: string) =>
  PATHS[key] ??
  (key.startsWith(PROJECT_PREFIX)
    ? `/projects/${key.slice(PROJECT_PREFIX.length)}`
    : key.startsWith(TAG_PREFIX)
      ? `/tags/${key.slice(TAG_PREFIX.length)}`
      : `/views/${key}`);

/** The watch key of a route: the inverse of navPath. */
export function routeKey(path: string, id?: string) {
  const builtIn = Object.keys(PATHS).find((key) => PATHS[key] === path);
  if (builtIn) return builtIn;
  if (path.startsWith('/projects/')) return `${PROJECT_PREFIX}${id}`;
  return path.startsWith('/tags/') ? `${TAG_PREFIX}${id}` : String(id);
}

/** `catalog.nav` as it is: no second reading of the replica. */
export function navEntries(catalog: Catalog | undefined): NavEntry[] {
  const names = new Map<string, string>([
    ...(catalog?.projects ?? []).map(
      (p) => [PROJECT_PREFIX + p.id, p.name] as const,
    ),
    ...(catalog?.tags ?? []).map((t) => [TAG_PREFIX + t.id, t.name] as const),
  ]);
  return (
    (catalog?.nav ?? [])
      // A tag the catalog does not list has no name to show.
      .filter(({ key }) => !key.startsWith(TAG_PREFIX) || names.has(key))
      .map(({ key, count }) => ({
        key,
        count,
        path: navPath(key),
        name: names.get(key) ?? null,
      }))
  );
}

/** A key the screen labels itself (`nav.<key>`), before any catalog. */
export const isBuiltIn = (key: string) => Object.hasOwn(PATHS, key);

/** The task count a destination shows: a navigation key's own catalog.nav
 *  count, so header and sidebar agree; a saved view's open items, since a
 *  board or calendar also lists recently closed cards. */
export function shownCount(
  key: string,
  catalog: Catalog | undefined,
  items: readonly { closed: boolean }[] | undefined,
) {
  const entry = catalog?.nav.find((e) => e.key === key);
  return entry?.count ?? (items ?? []).filter((i) => !i.closed).length;
}
