import { readdirSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  count,
  day,
  expect,
  seedTask,
  seedView,
  signIn,
  swActivated,
  tasks,
  test,
} from './fixtures';

test('layout switch preserves URL history, drawer context and focus', async ({
  page,
  account,
  cli,
}) => {
  const view = await seedView(
    page.request,
    account.token,
    'Planning',
    'a0',
    'list',
  );
  const secondary = await seedView(
    page.request,
    account.token,
    'Secondary',
    'a1',
    'kanban',
  );
  await cli(account.token, 'add', 'First task');
  await cli(account.token, 'add', 'Keep context');
  await page.goto(`/views/${view}?mode=month&at=2026-10-01&custom=kept`);

  const modes = page.getByRole('tablist', { name: 'Layout' });
  await expect(modes.getByRole('tab', { name: 'List' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    modes.getByRole('tab', { name: 'Calendar' }),
  ).not.toHaveAttribute('aria-disabled');

  await modes.getByRole('tab', { name: 'List' }).press('ArrowRight');
  await expect(modes.getByRole('tab', { name: 'Kanban' })).toBeFocused();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page).toHaveURL(/layout=kanban/);
  await expect(page).toHaveURL(/mode=month/);
  await expect(page).toHaveURL(/at=2026-10-01/);
  await expect(page).toHaveURL(/custom=kept/);
  await page.reload();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page).toHaveURL(/layout=kanban/);

  const card = page.getByTestId('card').filter({ hasText: 'Keep context' });
  await card.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  const closeBox = await drawer
    .getByRole('button', { name: 'Close' })
    .boundingBox();
  expect(closeBox?.width).toBeGreaterThanOrEqual(44);
  expect(closeBox?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect(page).toHaveURL(/layout=kanban/);
  await expect(page).not.toHaveURL(/task=/);

  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Secondary', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/views/${secondary}`));
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page).toHaveURL(/custom=kept/);
  await expect(page.getByTestId('board')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/views/${view}`));
  await expect(page).toHaveURL(/layout=kanban/);
  await expect(page).toHaveURL(/custom=kept/);

  await modes.getByRole('tab', { name: 'List' }).click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page.getByTestId('task-list')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('board')).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId('task-list')).toBeVisible();

  await page.goto('/');
  await page.goto(`/views/${view}?layout=tiles&custom=kept`);
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page).toHaveURL(/custom=kept/);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
});

const cell = (page: Page, date: string) =>
  page.locator(`[data-testid="calendar-day"][data-date="${date}"]`);
const chip = (page: Page, date: string, title: string) =>
  cell(page, date).getByTestId('placement').filter({ hasText: title });

test('a saved list view shows transient Calendar placements', async ({
  page,
  account,
}) => {
  const view = await seedView(
    page.request,
    account.token,
    'Planning',
    'a0',
    'list',
  );
  await seedTask(page.request, account.token, {
    title: 'Report',
    scheduledOn: day(),
  });
  const modes = page.getByRole('tablist', { name: 'Layout' });

  await page.goto(`/views/${view}?layout=calendar`);
  await expect(chip(page, day(), 'Report')).toBeVisible();
  await expect(modes.getByRole('tab', { name: 'Calendar' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(/layout=calendar/);

  // All open has no saved calendar either.
  await page.goto('/?layout=calendar');
  await expect(chip(page, day(), 'Report')).toBeVisible();

  // The override saved nothing: without it, the view is a list again.
  await page.goto(`/views/${view}`);
  await expect(page.getByTestId('task-list')).toBeVisible();
  await expect(page.getByTestId('calendar-day')).toHaveCount(0);
  await expect(modes.getByRole('tab', { name: 'List' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('a saved calendar view switches to List and Kanban', async ({
  page,
  account,
  cli,
}) => {
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await cli(account.token, 'add', 'Plain task');
  const modes = page.getByRole('tablist', { name: 'Layout' });
  await page.goto(`/views/${view}?mode=month&at=2026-10-01`);
  await expect(cell(page, '2026-10-01')).toBeVisible();

  await modes.getByRole('tab', { name: 'List' }).click();
  await expect(page).toHaveURL(/layout=list/);
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByTestId('calendar-day')).toHaveCount(0);

  await modes.getByRole('tab', { name: 'List' }).press('ArrowRight');
  await expect(modes.getByRole('tab', { name: 'Kanban' })).toBeFocused();
  await expect(page).toHaveURL(/layout=kanban/);
  await expect(page.getByTestId('card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('card')).toHaveCount(1);

  // Back on the saved layout: the override is gone and so is nothing else.
  await modes.getByRole('tab', { name: 'Kanban' }).press('ArrowRight');
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page).toHaveURL(/mode=month/);
  await expect(cell(page, '2026-10-01')).toBeVisible();

  await page.goto(`/views/${view}`);
  await expect(cell(page, day())).toBeVisible();
  await expect(page.getByTestId('task-row')).toHaveCount(0);
});

test('drawer parent navigation preserves the original task opener', async ({
  page,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Parent task');
  await page.goto('/');
  const drawer = page.getByRole('dialog');
  const parentTitle = page
    .getByTestId('task-row')
    .filter({ hasText: 'Parent task' })
    .getByTestId('task-title');
  await parentTitle.click();
  const add = drawer.getByRole('textbox', { name: 'Add subtask' });
  await add.fill('Child task');
  await add.press('Enter');
  await expect(
    drawer.getByRole('checkbox', { name: 'Done: Child task' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const childTitle = page
    .getByTestId('task-row')
    .filter({ hasText: 'Child task' })
    .getByTestId('task-title');
  await childTitle.click();
  await drawer.getByTestId('subtask-of').click();
  await expect(drawer.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Parent task',
  );
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(childTitle).toBeFocused();
});

test('sees a CLI write on focus', async ({ page, account, cli }) => {
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(0));
  await cli(account.token, 'add', 'from the cli');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(count(page)).toHaveText(tasks(1), { timeout: 10_000 });
});

test('the 30 s tick syncs a visible tab', async ({ page, account, cli }) => {
  // The clock drives the tab's interval only; the worker runs in real time,
  // and its engine drops a tick within 25 s of the last sync (several
  // windows tick). So real time passes first, then the tab's 30 s.
  await page.clock.install();
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  await cli(account.token, 'add', 'from the cli');
  await page.waitForTimeout(26_000);
  await page.clock.runFor(30_000);
  await expect(count(page)).toHaveText(tasks(1), { timeout: 10_000 });
});

// The one test that signs in through the form (fixtures.ts).
test('a reload restores the session through the cookie', async ({
  page,
  credentials,
}) => {
  const refreshes: number[] = [];
  page.context().on('request', (r) => {
    if (r.url().endsWith('/api/v1/auth/refresh')) refreshes.push(Date.now());
  });
  await page.goto('/');
  await signIn(page, credentials);
  await page.reload();
  await expect(count(page)).toBeVisible();
  await expect(page.getByTestId('sign-in')).toHaveCount(0);
  expect(refreshes, 'the hint: exactly one refresh').toHaveLength(1);

  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('sign-in')).toBeVisible();
  refreshes.length = 0;
  await page.reload();
  await expect(page.getByTestId('sign-in')).toBeVisible();
  expect(refreshes, 'no hint, no refresh (departure 4)').toEqual([]);
  // Signed out, no replica data: the form and no sidebar.
  await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0);
  await expect(count(page)).toHaveCount(0);
});

test('the document language follows the interface language', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('sign-in')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('switch', { name: 'Interface language' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

test('the document has a title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('sign-in')).toBeVisible();
  await expect(page).toHaveTitle('Todoer');
});

test('wrong password', async ({ page }, { testId }) => {
  const text = (locale: string) =>
    (
      JSON.parse(
        readFileSync(
          new URL(`../i18n/locales/${locale}.json`, import.meta.url),
          'utf8',
        ),
      ) as { errors: Record<string, string> }
    ).errors['invalid-credentials']!;
  await page.goto('/');
  // No account: an unknown address is refused like a wrong password, and
  // it spends no registration.
  await page.getByTestId('email').fill(`nobody-${testId}@example.test`);
  await page.getByTestId('password').fill('not the password at all');
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('sign-in-error')).toContainText(text('en'));
  await page
    .getByRole('switch', {
      name: 'Interface language',
    })
    .click();
  await expect(page.getByTestId('sign-in-error')).toContainText(text('ru'));
});

test('the SW never answers /api', async ({ page }) => {
  await page.goto('/');
  await swActivated(page);
  await page.reload();
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
  ).toBe(true);
  const health = (await page.goto('/api/v1/health'))!;
  expect(health.status()).toBe(200);
  expect(health.fromServiceWorker()).toBe(false);
  expect(await health.json()).toMatchObject({ status: 'ok' });
  // The denylist's other shapes (the query form was a hole once): the
  // server answers them, whatever it answers, and never with the shell.
  // Firefox fails a navigation to a 4xx JSON body, hence the response event.
  for (const path of ['/api?probe=1', '/API/v1/health', '/health?probe=1']) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url() === new URL(path, r.url()).href),
      page.goto(path).catch(() => null),
    ]);
    expect(response.fromServiceWorker(), path).toBe(false);
    expect(response.headers()['content-type'], path).toContain('json');
  }
});

// F8: the denylist and the prompt-only activation, read off the built file.
test('the built service worker keeps the denylist and waits to activate', () => {
  const sw = readFileSync(
    new URL('../.output/public/sw.js', import.meta.url),
    'utf8',
  );
  expect(sw).toContain(
    String.raw`denylist:[/^\/api(\/|\?|$)/i,/^\/health(\/|\?|$)/i]`,
  );
  expect(sw).not.toContain('clientsClaim');
  // One skipWaiting, the prompt's SKIP_WAITING handler; none on install.
  expect(sw.match(/skipWaiting/g)).toHaveLength(1);
  expect(sw).toMatch(/"SKIP_WAITING"===\w+\.data\.type&&self\.skipWaiting\(\)/);
});

test('the WASM is served as application/wasm', async ({ request }) => {
  const dir = new URL('../.output/public/_nuxt/', import.meta.url);
  const wasm = readdirSync(dir).filter((f) => f.endsWith('.wasm'));
  expect(wasm).not.toHaveLength(0);
  for (const file of wasm) {
    const response = await request.get(`/_nuxt/${file}`);
    expect(response.headers()['content-type'], file).toBe('application/wasm');
  }
});
