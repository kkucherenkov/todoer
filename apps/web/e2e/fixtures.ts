import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export { expect };

export type Account = { email: string; password: string; token: string };

const OWNER = {
  email: process.env.OWNER_EMAIL ?? 'owner@example.test',
  password: process.env.OWNER_PASSWORD ?? 'correct horse 9 battery!',
};
const PASSWORD = 'correct horse 9 battery!';
const CLI = fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url));

/**
 * POST to the API. A 429 names the limit it hit: the server counts every
 * login and registration per IP (20 per 15 minutes each), and a run that
 * spends them should say so instead of timing out somewhere later.
 */
async function post(
  api: APIRequestContext,
  path: string,
  data: object,
  bearer?: string,
) {
  const response = await api.post(`/api/v1${path}`, {
    data,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  if (response.status() === 429) {
    throw new Error(
      `POST ${path} answered 429: the per-IP limit on ${path} (20 per 15 minutes) is spent; restart the backend`,
    );
  }
  return response;
}

/** The owner's access token: registered on an empty instance, else logged in. */
async function ownerToken(api: APIRequestContext): Promise<string> {
  let response = await post(api, '/auth/register', OWNER);
  if (response.status() !== 201) {
    response = await post(api, '/auth/login', OWNER);
    expect(response.status(), 'owner login').toBe(200);
  }
  return ((await response.json()) as { accessToken: string }).accessToken;
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

export const test = base.extend<
  {
    account: Account;
    cli: (token: string, ...args: string[]) => Promise<string>;
    guard: void;
  },
  { owner: string }
>({
  // The fresh-user.sh flow over Playwright's request (budget: one owner login
  // per worker, one registration and one UI sign-in per test).
  owner: [
    async ({ playwright }, use, { project }) => {
      const api = await playwright.request.newContext({
        ...(project.use.baseURL && { baseURL: project.use.baseURL }),
      });
      await use(await ownerToken(api));
      await api.dispose();
    },
    { scope: 'worker' },
  ],

  account: async ({ owner, playwright, baseURL }, use, { testId }) => {
    const api = await playwright.request.newContext({
      ...(baseURL && { baseURL }),
    });
    const invite = await post(api, '/auth/invites', {}, owner);
    expect(invite.status(), 'invitation').toBe(201);
    const { token: invitation } = (await invite.json()) as { token: string };
    const email = `e2e-${testId}-${Date.now()}@example.test`;
    // The body transport: the CLI needs the access token itself.
    const registered = await post(api, '/auth/register', {
      email,
      password: PASSWORD,
      invitation,
    });
    expect(registered.status(), 'registration').toBe(201);
    const { accessToken } = (await registered.json()) as {
      accessToken: string;
    };
    await api.dispose();
    await use({ email, password: PASSWORD, token: accessToken });
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
