import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  count,
  expect,
  projectId,
  seedView,
  swActivated,
  tasks,
  test,
} from './fixtures';

/** Lets the test cut the tab's open event stream, as a dropped connection
 *  would: a route reaches only the requests made after it, never the
 *  stream already open. */
const cuttable = (page: Page) =>
  page.addInitScript(() => {
    const real = window.fetch.bind(window);
    const open = new Set<AbortController>();
    window.fetch = (input, init = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/engine/events')) return real(input, init);
      const cut = new AbortController();
      init.signal?.addEventListener('abort', () => cut.abort());
      open.add(cut);
      return real(input, { ...init, signal: cut.signal });
    };
    (window as { cut?: () => void }).cut = () => {
      for (const c of open) c.abort(new TypeError('e2e: connection lost'));
      open.clear();
    };
  });

const titled = (page: Page, title: string) =>
  page.getByTestId('task-title').filter({ hasText: title });

test('a write in one tab reaches the other', async ({ page, account }) => {
  void account; // signed in
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(0));
  const b = await page.context().newPage();
  await b.goto('/');
  await expect(count(b)).toHaveText(tasks(0));
  const input = page.getByRole('textbox', { name: 'Quick add' });
  await input.fill('from tab A');
  await input.press('Enter');
  await expect(titled(page, 'from tab A')).toBeVisible();
  await expect(titled(b, 'from tab A')).toBeVisible({ timeout: 5_000 });
  await expect(count(b)).toHaveText(tasks(1));
});

test('two tabs: a mark shows in the other, each tab keeps to its own view', async ({
  page,
  account,
  cli,
}) => {
  const titles = (p: Page) => async () =>
    (await p.getByTestId('task-title').allTextContents()).sort();
  for (const t of ['Sweep #home', 'Weed #home', 'Call #work']) {
    await cli(account.token, 'add', t);
  }
  const home = await seedView(
    page.request,
    account.token,
    'Home',
    'a0',
    'list',
    { project: await projectId(page.request, account.token, 'home') },
  );
  const work = await seedView(
    page.request,
    account.token,
    'Work',
    'a1',
    'list',
    { project: await projectId(page.request, account.token, 'work') },
  );
  await page.goto('/');
  await expect.poll(titles(page)).toEqual(['Call', 'Sweep', 'Weed']);
  const b = await page.context().newPage();
  await b.goto('/');
  await expect.poll(titles(b)).toEqual(['Call', 'Sweep', 'Weed']);

  // The same view in both: a mark in A shows in B without a reload.
  await page
    .getByTestId('task-row')
    .filter({ hasText: 'Sweep' })
    .getByRole('button', { name: 'Mark done' })
    .click();
  await expect.poll(titles(b)).toEqual(['Call', 'Weed']);

  // A different view each: a write in one reaches only the tab showing it.
  const open = (p: Page, name: string) =>
    p
      .getByRole('navigation', { name: 'Views' })
      .getByRole('link', { name, exact: true })
      .click();
  await open(page, 'Home');
  await expect(page).toHaveURL(new RegExp(`/views/${home}$`));
  await open(b, 'Work');
  await expect(b).toHaveURL(new RegExp(`/views/${work}$`));
  await expect.poll(titles(page)).toEqual(['Weed']);
  await expect.poll(titles(b)).toEqual(['Call']);

  const input = page.getByRole('textbox', { name: 'Quick add' });
  await input.fill('Mop #home');
  await input.press('Enter');
  await expect.poll(titles(page)).toEqual(['Mop', 'Weed']);
  await b.getByTestId('sync-now').click(); // a round trip to B, and back
  await expect(b.getByTestId('sync-now')).toBeEnabled();
  await expect(titles(b)()).resolves.toEqual(['Call']);

  await b
    .getByTestId('task-row')
    .getByRole('button', { name: 'Mark done' })
    .click();
  await expect(b.getByTestId('task-row')).toHaveCount(0);
  await expect(titles(page)()).resolves.toEqual(['Mop', 'Weed']);
});

test('a CLI write reaches an open page', async ({ page, account, cli }) => {
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(0));
  await cli(account.token, 'add', 'from the cli');
  // No focus, no reload, no Sync now: the server's engine publishes it.
  await expect(titled(page, 'from the cli')).toBeVisible({ timeout: 5_000 });
  await expect(count(page)).toHaveText(tasks(1));
});

test('writes are blocked while the stream is down', async ({
  page,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Water plants');
  await cuttable(page);
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Quick add' });
  await expect(input).toBeEnabled();
  // A toast that stays up while the connection goes and comes back.
  await page
    .getByTestId('task-row')
    .filter({ has: titled(page, 'Water plants') })
    .getByRole('button', { name: 'Mark done' })
    .click();
  const undo = page.getByRole('button', { name: 'Undo' });
  await undo.hover(); // a hovered toast does not time out

  await page.route('**/engine/events*', (route) => route.abort());
  await page.evaluate(() => (window as { cut?: () => void }).cut!());
  await expect(input).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Add task', exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId('sync-now')).toBeDisabled();
  await expect(undo).toBeDisabled();
  await expect(page.getByTestId('unreachable')).toHaveText(
    'Cannot reach the server',
  );

  // Written elsewhere while this tab hears nothing.
  await cli(account.token, 'add', 'Written during the outage');
  await expect(titled(page, 'Written during the outage')).toHaveCount(0);

  // Back: the next retry opens a stream, with a fresh snapshot.
  await page.unroute('**/engine/events*');
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await expect(titled(page, 'Written during the outage')).toBeVisible();
  await expect(page.getByTestId('unreachable')).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(titled(page, 'Water plants')).toBeVisible();
});

// F9. Signed out on purpose: neither case needs an account.
test('a new service worker waits for the prompt in every tab', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await swActivated(page);
  await page.reload();
  const b = await context.newPage();
  await b.goto('/');
  const tabs = [page, b];
  // Survives until the tab reloads. Not the title: the app's head manager
  // owns it and writes it back.
  const marked = (tab: Page) =>
    tab.evaluate(() => (window as { old?: true }).old === true);
  for (const tab of tabs)
    await tab.evaluate(() => ((window as { old?: true }).old = true));
  // A new deployment, as far as the SW update check can tell: sw.js is the
  // only file the backend reads per request (index.html needs a restart).
  const file = new URL('../.output/public/sw.js', import.meta.url);
  const original = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, `${original}\n// e2e: a new deployment\n`);
    await page.evaluate(async () =>
      (await navigator.serviceWorker.ready).update(),
    );
    for (const tab of tabs) {
      await expect(tab.getByTestId('update-available')).toBeVisible();
      expect(await marked(tab), 'never reloaded under the user').toBe(true);
    }
    // One acceptance activates it, and every tab that offered it reloads
    // onto it: a tab left on the old build would face the new worker.
    await page.getByTestId('update-available').getByRole('button').click();
    for (const tab of tabs) {
      await expect.poll(() => marked(tab).catch(() => true)).toBe(false);
      await expect(tab.getByTestId('update-available')).toHaveCount(0);
    }
  } finally {
    writeFileSync(file, original);
  }
});
