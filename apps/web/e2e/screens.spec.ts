import { count, expect, seedView, test } from './fixtures';

// The browser no longer syncs: the server's engine does, in process, so a
// refused sync cannot be staged from the page any more.
test('the sidebar lists views in rank order', async ({ page, account }) => {
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
});

test('an empty account says so, and the footer reads in order', async ({
  page,
  account,
}) => {
  void account; // signed in, with nothing in it
  await page.goto('/');
  await expect(count(page)).toHaveText('0 tasks');
  await expect(page.getByText('No open tasks.')).toBeVisible();

  // ux.js #sync-footer: count, saved, badges, last sync.
  const footer = [
    'task-count',
    'saved',
    'sync-badges',
    'last-synced',
    'sync-now',
  ];
  await expect(page.getByTestId('saved')).toHaveText('Saved on the server');
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

test('a newer build on the server prompts in the workspace alerts', async ({
  page,
  account,
}) => {
  void account;
  // Nuxt asks for the latest build id every 5 minutes (nuxt.config.ts).
  await page.clock.install();
  await page.route('**/_nuxt/builds/latest.json*', (route) =>
    route.fulfill({ json: { id: 'a-newer-build', timestamp: Date.now() } }),
  );
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  await expect(page.getByTestId('update-available')).toHaveCount(0);
  await page.clock.runFor(5 * 60_000 + 1_000);
  const prompt = page.getByTestId('alerts').getByTestId('update-available');
  await expect(prompt).toContainText('Your tasks are kept on the server.');
  await expect(page.getByTestId('update-available')).toHaveCount(1);
});
