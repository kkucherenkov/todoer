import { readdirSync, readFileSync } from 'node:fs';
import { count, expect, signIn, swActivated, tasks, test } from './fixtures';

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
  await page.getByRole('button', { name: 'Русский' }).click();
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
