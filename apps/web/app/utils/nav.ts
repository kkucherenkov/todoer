import {
  ALL,
  PROJECT_PREFIX,
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

/** The route of a watch key: a built-in, `project:<id>` or a saved view id. */
export const navPath = (key: string) =>
  PATHS[key] ??
  (key.startsWith(PROJECT_PREFIX)
    ? `/projects/${key.slice(PROJECT_PREFIX.length)}`
    : `/views/${key}`);

/** The watch key of a route: the inverse of navPath. */
export function routeKey(path: string, id?: string) {
  const builtIn = Object.keys(PATHS).find((key) => PATHS[key] === path);
  if (builtIn) return builtIn;
  return path.startsWith('/projects/') ? `${PROJECT_PREFIX}${id}` : String(id);
}

/** `catalog.nav` as it is: no second reading of the replica. */
export function navEntries(catalog: Catalog | undefined): NavEntry[] {
  const names = new Map(
    (catalog?.projects ?? []).map((p) => [`${PROJECT_PREFIX}${p.id}`, p.name]),
  );
  return (catalog?.nav ?? []).map(({ key, count }) => ({
    key,
    count,
    path: navPath(key),
    name: names.get(key) ?? null,
  }));
}
