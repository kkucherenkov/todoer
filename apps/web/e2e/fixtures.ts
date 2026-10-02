import {
  test as base,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PASSWORD, post, type Tokens } from './global-setup';

export { expect };

export type Account = { email: string; password: string; token: string };
/** The worker's account and the head of its one session's refresh chain. */
type User = { email: string; password: string; refresh: string | null };

const CLI = fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url));
/** The web client's "a cookie session may exist" bit (plugins/db.client.ts). */
const HINT = 'todoer.session';

/** The next link of the worker's session: a successful refresh, which the
 *  server never counts. A login only starts a chain, on the worker's first
 *  test or after a test signed out. A chain that broke in a passing test
 *  fails here rather than spending a login per test from then on (a failed
 *  test restarts the worker, and with it the chain). */
async function renew(api: APIRequestContext, user: User): Promise<Tokens> {
  if (user.refresh !== null) {
    const response = await post(api, '/auth/refresh', {
      refreshToken: user.refresh,
    });
    expect(
      response.status(),
      'the previous test left the session it was handed unusable',
    ).toBe(200);
    return (await response.json()) as Tokens;
  }
  const { email, password } = user;
  const response = await post(api, '/auth/login', { email, password });
  expect(response.status(), 'login').toBe(200);
  return (await response.json()) as Tokens;
}

/** Deletes every live row the account can delete, subtasks before their
 *  parents, so each test starts as on a new account. The client seeds
 *  statuses again when none is live; task_tag and task_occurrence rows are
 *  never deleted and point at tombstones, as after any delete. */
async function wipe(api: APIRequestContext, token: string) {
  const pulled = await post(api, '/sync', { since: 0, ops: [] }, token);
  expect(pulled.status(), 'pull').toBe(200);
  const { changes } = (await pulled.json()) as {
    changes: {
      table: string;
      id: string;
      row: { version: number; parentId?: string | null };
    }[];
  };
  const order = (c: (typeof changes)[number]) =>
    c.table === 'task' && c.row.parentId ? 0 : 1;
  const ops = changes
    .filter((c) =>
      ['task', 'project', 'tag', 'view', 'status'].includes(c.table),
    )
    .sort((a, b) => order(a) - order(b))
    .map((c) => ({
      opId: crypto.randomUUID(),
      kind: 'delete',
      table: c.table,
      id: c.id,
      baseVersion: c.row.version,
    }));
  if (ops.length === 0) return;
  const deleted = await post(api, '/sync', { since: 0, ops }, token);
  expect(deleted.status(), 'wipe').toBe(200);
  const { results } = (await deleted.json()) as {
    results: { status: string; reason?: string }[];
  };
  expect(
    results.filter((r) => r.status !== 'applied'),
    'wipe',
  ).toEqual([]);
}

declare global {
  interface Window {
    __violations?: string[];
  }
}

const CSP_TEXT = /Content.Security.Policy|Refused to|\[csp\]/;

/** The page's own collector. Firefox still settles a failed navigation (a
 *  4xx JSON body) after `goto` rejects: read again once it has loaded. */
async function seen(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => window.__violations ?? []);
  } catch (error) {
    if (!String(error).includes('Execution context was destroyed')) throw error;
    await page.waitForLoadState();
    return seen(page);
  }
}

/**
 * The per-IP auth budgets (README) are a product property, so the suite
 * spends a fixed amount whatever the number of tests: global-setup.ts
 * registers one account per project, each worker logs it in once, and each
 * test continues that one session with a refresh, which the server never
 * counts when it succeeds. Every test wipes the account first, so none
 * depends on another's data or order. Only the tests of the sign-in form
 * sign in through it.
 */
export const test = base.extend<
  {
    /** The worker's account, wiped, with a fresh access token for the CLI.
     *  The browser is signed out: for the tests of the sign-in form. */
    credentials: Account;
    /** The same, with the browser signed in through the worker's session. */
    account: Account;
    cli: (token: string, ...args: string[]) => Promise<string>;
    guard: void;
  },
  { user: User }
>({
  // Registered by global-setup.ts; signed in by the first test that needs it.
  user: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads the pattern
    async ({}, use, { project }) => {
      const accounts = JSON.parse(process.env.E2E_ACCOUNTS ?? '{}') as Record<
        string,
        string
      >;
      const email = accounts[project.name];
      if (!email)
        throw new Error(`global-setup.ts made no account for ${project.name}`);
      await use({ email, password: PASSWORD, refresh: null });
    },
    { scope: 'worker' },
  ],

  credentials: async ({ user, playwright, baseURL }, use) => {
    const api = await playwright.request.newContext({
      ...(baseURL && { baseURL }),
    });
    const { accessToken, refreshToken } = await renew(api, user);
    user.refresh = refreshToken;
    await wipe(api, accessToken);
    await api.dispose();
    await use({
      email: user.email,
      password: user.password,
      token: accessToken,
    });
  },

  // The chain's head goes into this context only, and comes back from it:
  // the page rotates it, and a token two contexts held would trip the
  // server's reuse detection once the 30 s grace has passed.
  account: async ({ credentials, user, context }, use) => {
    await context.addCookies([
      {
        name: 'todoer_refresh',
        value: user.refresh!,
        domain: 'localhost',
        path: '/api/v1/auth',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    await context.addInitScript((hint) => {
      try {
        localStorage.setItem(hint, '1');
      } catch {
        // about:blank has no storage
      }
    }, HINT);
    await use(credentials);
    user.refresh =
      (await context.cookies()).find((c) => c.name === 'todoer_refresh')
        ?.value ?? null;
  },

  cli: async ({ baseURL }, use) => {
    const home = await mkdtemp(join(tmpdir(), 'todoer-e2e-'));
    await use(async (token, ...args) => {
      const { stdout } = await promisify(execFile)('node', [CLI, ...args], {
        env: {
          ...process.env,
          HOME: home,
          TODOER_TOKEN: token,
          TODOER_URL: `${baseURL}/api/v1`,
        },
      });
      return stdout;
    });
    await rm(home, { recursive: true, force: true });
  },

  // Every test, every page of its context, and their workers (FR-012).
  guard: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const violations: string[] = [];
      const foreign: string[] = [];
      // Init scripts run outside the page's CSP; bypassCSP stays false.
      await context.addInitScript(() => {
        window.__violations = [];
        document.addEventListener(
          'securitypolicyviolation',
          (e) =>
            window.__violations!.push(`${e.violatedDirective} ${e.blockedURI}`),
          true,
        );
      });
      // The worker forwards its own violations as `console.error('[csp]', …)`.
      context.on('console', (m) => {
        if (CSP_TEXT.test(m.text())) violations.push(m.text());
      });
      context.on('request', (r) => {
        if (new URL(r.url()).origin !== origin) foreign.push(r.url());
      });
      await use();
      // The browser logs every violation to the console as well, so a page
      // closed before this point is covered by the collector above.
      for (const page of context.pages()) {
        violations.push(...(await seen(page)));
      }
      expect(violations, 'CSP violations').toEqual([]);
      expect(foreign, 'requests to another origin').toEqual([]);
    },
    { auto: true },
  ],
});

/** Sign in through the form on a page that shows it. */
export async function signIn(page: Page, { email, password }: Account) {
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in').click();
  await expect(count(page)).toBeVisible();
}

/** Wait until the SW is active: a reload while it still activates leaves
 *  the page uncontrolled. */
/** Waits for an activated service worker, failing in 10 s rather than the
 *  whole test timeout when none ever registers. */
export const swActivated = (page: Page) =>
  page.evaluate(async () => {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('no service worker activated in 10 s')),
        10_000,
      ),
    );
    const sw = (await Promise.race([navigator.serviceWorker.ready, timeout]))
      .active!;
    if (sw.state !== 'activated') {
      await Promise.race([
        new Promise((r) => sw.addEventListener('statechange', r)),
        timeout,
      ]);
    }
  });

export const count = (page: Page) => page.getByTestId('task-count');

/** The placeholder's count, in English. */
export const tasks = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

/** A view the CLI cannot make but the API can: one `create view` op.
 *  Returns its id. */
export async function seedView(
  request: APIRequestContext,
  token: string,
  name: string,
  rank: string,
  layout = 'kanban',
  filter: object = { and: [] },
): Promise<string> {
  const id = crypto.randomUUID();
  const response = await request.post('/api/v1/sync', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      since: 0,
      ops: [
        {
          opId: crypto.randomUUID(),
          kind: 'create',
          table: 'view',
          id,
          fields: { name, layout, sort: 'manual', rank, filter },
          ts: new Date().toISOString(),
        },
      ],
    },
  });
  expect(response.status(), `create view ${name}`).toBe(200);
  return id;
}

/** The id of the project the CLI made for `#name`, from a pull. */
export async function projectId(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await request.post('/api/v1/sync', {
    headers: { authorization: `Bearer ${token}` },
    data: { since: 0, ops: [] },
  });
  expect(response.status(), 'pull').toBe(200);
  const { changes } = (await response.json()) as {
    changes: { table: string; id: string; row: { name?: string } }[];
  };
  const found = changes.find(
    (c) => c.table === 'project' && c.row.name === name,
  );
  expect(found, `project ${name}`).toBeDefined();
  return found!.id;
}

/** A local date, YYYY-MM-DD, `offset` days from today. */
export const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('sv');
};

/** With a menu open, arrows down until `item` has the focus. */
export async function arrowTo(page: Page, item: Locator) {
  for (
    let i = 0;
    i < 8 && !(await item.evaluate((e) => e === document.activeElement));
    i++
  ) {
    await page.keyboard.press('ArrowDown');
  }
}

/** A task the CLI cannot make (it has no `scheduledOn` or `dueOn` flag): one
 *  `create task` op. Returns its id. */
export async function seedTask(
  request: APIRequestContext,
  token: string,
  fields: { title: string; scheduledOn?: string; dueOn?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  const response = await request.post('/api/v1/sync', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      since: 0,
      ops: [
        {
          opId: crypto.randomUUID(),
          kind: 'create',
          table: 'task',
          id,
          fields: { priority: 0, rank: 'a0', ...fields },
          ts: new Date().toISOString(),
        },
      ],
    },
  });
  expect(response.status(), `create task ${fields.title}`).toBe(200);
  return id;
}
