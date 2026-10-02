import { count, expect, seedView, test } from './fixtures';

test('the sidebar lists views, and a sync that fails shows why', async ({
  page,
  context,
  account,
  browserName,
}) => {
  // Created out of rank order on purpose.
  await seedView(page.request, account.token, 'Second view', 'a1');
  await seedView(page.request, account.token, 'First view', 'a0');
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Views' });
  await expect(nav.getByRole('link')).toHaveText([
    'All open',
    'First view',
    'Second view',
  ]);
  await nav.getByRole('link', { name: 'Second view' }).click();
  await expect(page).toHaveURL(/\/views\/[0-9a-f-]+$/);
  await expect(page.getByTestId('view')).toBeVisible();

  // Firefox does not route a dedicated worker's fetch.
  if (browserName === 'chromium') {
    // A 4xx the client cannot settle is a refusal, shown with its reason...
    const answer = (status: number) =>
      context.route('**/api/v1/sync', (route) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'down for tests' }),
        }),
      );
    await answer(403);
    await page.getByTestId('sync-now').click();
    const alert = page.getByTestId('sync-problem');
    await expect(alert).toContainText('Sync refused');
    await expect(alert).toContainText('403');
    await expect(alert.getByRole('button', { name: 'Sync now' })).toBeVisible();
    // ...and a 5xx is the server being out of reach: offline wins.
    await context.unroute('**/api/v1/sync');
    await answer(503);
    await page.getByTestId('sync-now').click();
    await expect(page.getByTestId('offline')).toBeVisible();
    await expect(alert).toHaveCount(0);
  }
});
