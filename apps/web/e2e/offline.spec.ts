import type { Locator, Page } from '@playwright/test';
import {
  count,
  expect,
  projectId,
  seedView,
  swActivated,
  tasks,
  test,
} from './fixtures';

test('offline, then online', async ({
  page,
  context,
  account,
  cli,
  browserName,
}) => {
  test.skip(
    browserName === 'firefox',
    'Playwright’s setOffline(false) fires no `online` event in a Firefox page (navigator.onLine flips, and a manual sync then succeeds)',
  );
  await cli(account.token, 'add', 'synced before going offline');
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  await expect(count(page)).toHaveText(tasks(1));
  // The shell must be precached and the SW active before the network goes.
  await swActivated(page);

  await context.setOffline(true);
  await page.reload(); // the SW serves the shell
  await expect(page.getByTestId('offline')).toBeVisible({ timeout: 15_000 });
  await expect(count(page)).toHaveText(tasks(1));

  await cli(account.token, 'add', 'written while the tab was offline');
  await context.setOffline(false); // fires `online`
  await expect(page.getByTestId('offline')).toHaveCount(0, { timeout: 10_000 });
  await expect(count(page)).toHaveText(tasks(2));
});

const column = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
const card = (page: Page, name: string, title: string) =>
  column(page, name).getByTestId('card').filter({ hasText: title });
const drag = (page: Page, from: Locator, to: string) =>
  from.dragTo(column(page, to).getByTestId('cards'), {
    sourcePosition: { x: 3, y: 3 },
  });

test('offline: quick-add, done and a drag show at once and survive a reload', async ({
  page,
  context,
  account,
  cli,
  browserName,
}) => {
  const board = await seedView(page.request, account.token, 'Board', 'a0');
  for (const t of ['Card A', 'Finish me']) await cli(account.token, 'add', t);
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(2));
  await swActivated(page);

  await context.setOffline(true);
  await page.getByTestId('sync-now').click(); // a sync that cannot reach it
  await expect(page.getByTestId('offline')).toBeVisible({ timeout: 15_000 });

  // Three writes, each visible at once.
  const input = page.getByRole('textbox', { name: 'Quick add' });
  await input.fill('Written offline');
  await input.press('Enter');
  const rows = page.getByTestId('task-row');
  await expect(rows.filter({ hasText: 'Written offline' })).toBeVisible();
  await rows
    .filter({ hasText: 'Finish me' })
    .getByRole('button', { name: 'Mark done' })
    .click();
  await expect(rows.filter({ hasText: 'Finish me' })).toHaveCount(0);
  // Client-side navigation: no network needed for the board.
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Board' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/views/${board}$`));
  await drag(page, card(page, 'Inbox', 'Card A'), 'Doing');
  await expect(card(page, 'Doing', 'Card A')).toBeVisible();
  // The badge counts queued operations, not writes: a done and a drop are
  // each more than one.
  const pending = page.getByTestId('pending');
  await expect(pending).toHaveText(/^\d+ waiting$/);
  const waiting = await pending.innerText();
  expect(Number.parseInt(waiting)).toBeGreaterThanOrEqual(3);

  // A reload while offline: the SW serves the shell, the replica has all three.
  await page.reload();
  await expect(card(page, 'Doing', 'Card A')).toBeVisible();
  await expect(card(page, 'Inbox', 'Written offline')).toBeVisible();
  await expect(card(page, 'Inbox', 'Finish me')).toHaveCount(0);
  await expect(pending).toHaveText(waiting);

  // Firefox: no `online` event (see the test above); it ends here.
  if (browserName === 'firefox') return;
  await context.setOffline(false);
  await expect(page.getByTestId('pending')).toHaveCount(0, { timeout: 15_000 });
  const listed = JSON.parse(await cli(account.token, 'list', '--json')) as {
    data: { title: string; status: string | null }[];
  };
  expect(listed.data.map((t) => [t.title, t.status]).sort()).toEqual([
    ['Card A', 'Doing'],
    ['Written offline', 'Inbox'],
  ]);
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
      .getByRole('link', { name })
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
