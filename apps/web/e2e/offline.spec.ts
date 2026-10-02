import { count, expect, swActivated, tasks, test } from './fixtures';

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
