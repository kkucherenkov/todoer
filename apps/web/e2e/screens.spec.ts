import { count, expect, seedView, test } from './fixtures';

test('the sidebar lists views, and a sync that fails shows why', async ({
  page,
  context,
  account,
  browserName,
}) => {
  // One route, added before the page starts its worker and never removed.
  // A route added while a dedicated worker runs can miss that worker's next
  // fetch on a loaded machine: the sync reached the server, and Playwright
  // reported no request at all. Firefox does not route a worker's fetch.
  let status: number | undefined; // undefined: let the request through
  if (browserName === 'chromium') {
    await context.route('**/api/v1/sync', (route) =>
      status === undefined
        ? route.fallback()
        : route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'down for tests' }),
          }),
    );
  }
  // Created out of rank order on purpose.
  await seedView(page.request, account.token, 'Second view', 'a1');
  await seedView(page.request, account.token, 'First view', 'a0');
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Views' });
  // The built-ins carry their counts; saved views follow in rank order.
  await expect(nav.getByRole('link')).toHaveText([
    /^All open\s*0$/,
    /^Today\s*0$/,
    /^Upcoming\s*0$/,
    'First view',
    'Second view',
  ]);
  await nav.getByRole('link', { name: 'Second view' }).click();
  await expect(page).toHaveURL(/\/views\/[0-9a-f-]+$/);
  await expect(page.getByTestId('view')).toBeVisible();

  if (browserName === 'chromium') {
    // A 4xx the client cannot settle is a refusal, shown with its reason...
    status = 403;
    await page.getByTestId('sync-now').click();
    const alert = page.getByTestId('sync-problem');
    await expect(alert).toContainText('Sync refused');
    await expect(alert).toContainText('403');
    await expect(alert.getByRole('button', { name: 'Sync now' })).toBeVisible();
    // ...and a 5xx is the server being out of reach: offline wins.
    status = 503;
    await page.getByTestId('sync-now').click();
    await expect(page.getByTestId('offline')).toBeVisible();
    await expect(alert).toHaveCount(0);
  }
});

test('an empty account says so, and the footer reads in order', async ({
  page,
  account,
}) => {
  void account; // signed in, with nothing in it
  await page.goto('/');
  await expect(count(page)).toHaveText('0 tasks');
  await expect(page.getByText('No open tasks.')).toBeVisible();

  // ux.js #sync-footer: count, saved locally, badges, last sync.
  const footer = [
    'task-count',
    'saved-locally',
    'sync-badges',
    'last-synced',
    'sync-now',
  ];
  await expect(page.getByTestId('saved-locally')).toHaveText(
    'Saved on this device',
  );
  await expect(count(page)).toHaveCSS('font-size', '14px');
  await expect(count(page)).toHaveCSS('font-weight', '500');
  const order = await page.evaluate((ids) => {
    const at = ids.map((id) => document.querySelector(`[data-testid="${id}"]`));
    return at.every(
      (el, i) =>
        el !== null &&
        (i === 0 ||
          (at[i - 1]!.compareDocumentPosition(el) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0),
    );
  }, footer);
  expect(order, footer.join(' → ')).toBe(true);
});

test('the update prompt sits in the workspace alerts', async ({
  page,
  account,
}) => {
  void account;
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  // A message an older build would stamp marks this tab stale.
  await page.evaluate(() => {
    const channel = new BroadcastChannel('todoer');
    channel.postMessage({
      type: 'request',
      tab: 'old-tab',
      id: 1,
      command: { kind: 'sync', reason: 'manual' },
      build: 'an-older-build',
    });
    channel.close();
  });
  await expect(
    page.getByTestId('alerts').getByTestId('update-available'),
  ).toBeVisible();
  await expect(page.getByTestId('update-available')).toHaveCount(1);
});
