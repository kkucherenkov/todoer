import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { count, expect, swActivated, tasks, test } from './fixtures';

const focus = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event('focus')));

/** A signed-in leader A and a follower B in the same context. */
async function twoTabs(page: Page) {
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  const b = await page.context().newPage();
  await b.goto('/');
  await expect(count(b)).toHaveText(tasks(0));
  await expect(b.getByTestId('sign-in')).toHaveCount(0);
  return b;
}

test('a follower shares the leader’s worker', async ({
  page,
  account,
  cli,
}) => {
  const b = await twoTabs(page);
  expect(page.workers(), 'the leader runs the database').toHaveLength(1);
  expect(b.workers(), 'the follower starts none').toHaveLength(0);
  await cli(account.token, 'add', 'from the cli');
  await focus(b);
  await expect(count(b)).toHaveText(tasks(1), { timeout: 10_000 });
  await expect(count(page)).toHaveText(tasks(1));
});

test('leadership passes when the leader closes', async ({
  page,
  context,
  account,
  cli,
}) => {
  const b = await twoTabs(page);
  const cookie = async () =>
    (await context.cookies()).find((c) => c.name === 'todoer_refresh')!;
  const beforeHandOver = await cookie();
  await page.close();
  // B's own worker, signed in through the cookie and the hint, the count
  // read from OPFS. Its start refreshed: the cookie rotated.
  await expect.poll(() => b.workers().length, { timeout: 15_000 }).toBe(1);
  await expect(count(b)).toHaveText(tasks(0), { timeout: 15_000 });
  expect((await cookie()).value, 'rotated').not.toBe(beforeHandOver.value);
  await cli(account.token, 'add', 'from the cli');
  await focus(b);
  await expect(count(b)).toHaveText(tasks(1), { timeout: 10_000 });

  // As if B's refresh answer never arrived: the next leader presents the
  // rotated cookie, inside the server's 30 s grace (Review Focus 3).
  await context.addCookies([beforeHandOver]);
  const c = await context.newPage();
  await c.goto('/');
  await b.close();
  await expect(count(c)).toHaveText(tasks(1), { timeout: 15_000 });
  await expect(c.getByTestId('sign-in')).toHaveCount(0);
});

test('a new leader retries the pool until the old worker lets go', async ({
  page,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signs the context in
  account,
}) => {
  const b = await twoTabs(page);
  // Steal the lock from A and let it go at once: B's queued request takes
  // it while A's worker still holds every pool handle. B's install must
  // fail and retry (sqlite-wasm caches a failed install unless told
  // otherwise), and only A's close can let it succeed.
  const spawned: unknown[] = [];
  b.on('worker', (w) => spawned.push(w));
  await b.evaluate(() =>
    navigator.locks.request('todoer:leader', { steal: true }, () => undefined),
  );
  await expect.poll(() => b.workers().length).toBe(1);
  await expect(b.getByTestId('loading')).toBeVisible();
  await b.waitForTimeout(1_500); // several attempts fail meanwhile
  await expect(b.getByTestId('loading')).toBeVisible();
  await page.close();
  await expect(count(b)).toHaveText(tasks(0), { timeout: 15_000 });
  // The same worker recovered: a retry that never retries ends in `fatal`,
  // and the leader's respawn would hide it behind a second worker.
  expect(spawned, 'B’s workers').toHaveLength(1);
});

test('a crashing worker is restarted, then reported failed', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('sign-in')).toBeVisible();
  const crash = () =>
    page.workers()[0]!.evaluate(() =>
      setTimeout(() => {
        throw new Error('e2e: the worker crashed');
      }),
    );
  // Two crashes in a minute: restarted each time, the tab back to its form.
  for (let i = 0; i < 2; i++) {
    const next = page.waitForEvent('worker');
    await crash();
    await next;
    await expect(page.getByTestId('sign-in')).toBeVisible({ timeout: 10_000 });
  }
  // The third: no fourth worker, and the page says why.
  await crash();
  await expect(page.getByTestId('engine-failed')).toContainText(
    'e2e: the worker crashed',
  );
  await expect.poll(() => page.workers().length).toBe(0);
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
  // Survives until the tab reloads.
  for (const tab of tabs) await tab.evaluate(() => (document.title = 'old'));
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
      await expect(tab, 'never reloaded under the user').toHaveTitle('old');
    }
    // One acceptance activates it, and every tab that offered it reloads
    // onto it: a tab left on the old build would face the new worker.
    await page.getByTestId('update-available').getByRole('button').click();
    for (const tab of tabs) {
      await expect(tab).not.toHaveTitle('old');
      await expect(tab.getByTestId('update-available')).toHaveCount(0);
    }
  } finally {
    writeFileSync(file, original);
  }
});

test('a message from another build is refused and prompts a reload', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('sign-in')).toBeVisible();
  const b = await context.newPage();
  await b.goto('/');
  await expect(b.getByTestId('sign-in')).toBeVisible();
  // An old tab's request, as an old build would stamp it.
  const replies = await b.evaluate(async () => {
    const channel = new BroadcastChannel('todoer');
    const seen: unknown[] = [];
    channel.onmessage = ({ data }: MessageEvent<{ type: string }>) => {
      if (data.type === 'reply') seen.push(data);
    };
    channel.postMessage({
      type: 'request',
      tab: 'old-tab',
      id: 1,
      command: { kind: 'sync', reason: 'manual' },
      build: 'an-older-build',
    });
    await new Promise((r) => setTimeout(r, 1_000));
    channel.close();
    return seen;
  });
  expect(replies, 'the worker ran nothing for it').toEqual([]);
  for (const tab of [page, b]) {
    await expect(tab.getByTestId('update-available')).toBeVisible();
  }
});
