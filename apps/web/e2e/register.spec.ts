import type { BrowserContext, Route } from '@playwright/test';
import { count, expect, test } from './fixtures';

// global-setup.ts registers accounts first, so the instance is never empty
// here: the status is intercepted, and so is the registration, which keeps
// the suite's registration budget where README says it is. The worker sends
// POST /auth/register, hence routes on the context, not the page.
const STATUS = '**/api/v1/auth/registration';
const REGISTER = '**/api/v1/auth/register';

const open = (context: BrowserContext) =>
  context.route(STATUS, (route) => route.fulfill({ json: { open: true } }));

/** Records each registration body and answers with `answer`. */
async function registrations(
  context: BrowserContext,
  answer: (route: Route) => Promise<void>,
) {
  const bodies: unknown[] = [];
  await context.route(REGISTER, async (route) => {
    bodies.push(route.request().postDataJSON());
    await answer(route);
  });
  return bodies;
}

test('a closed or unknown status keeps the sign-in form', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('sign-in')).toBeVisible();
  await expect(page.getByTestId('register-form')).toHaveCount(0);

  await context.route(STATUS, (route) => route.fulfill({ status: 500 }));
  await page.reload();
  await expect(page.getByTestId('sign-in')).toBeVisible();
  await expect(page.getByTestId('register-form')).toHaveCount(0);
});

test('an open instance shows registration; a refusal shows its reason', async ({
  page,
  context,
}) => {
  await open(context);
  const bodies = await registrations(context, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'registration is closed',
      }),
    }),
  );
  await page.goto('/');
  await expect(page.getByTestId('register-form')).toBeVisible();
  await expect(page.getByTestId('sign-in')).toHaveCount(0);

  await page.getByTestId('email').fill('first@example.test');
  await page.getByTestId('password').fill('correct horse 9 battery!');
  await page.getByTestId('confirm').fill('something else 9!');
  await page.getByTestId('register').click();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();
  expect(bodies, 'a mismatch sends nothing').toEqual([]);

  await page.getByTestId('confirm').fill('correct horse 9 battery!');
  await page.getByTestId('register').click();
  await expect(page.getByTestId('register-error')).toContainText(
    'registration is closed',
  );
  expect(bodies).toEqual([
    {
      email: 'first@example.test',
      password: 'correct horse 9 battery!',
      transport: 'cookie',
    },
  ]);
  await expect(page.getByTestId('register-form')).toBeVisible();
});

test('an accepted registration lands in the app', async ({
  page,
  context,
  credentials,
}) => {
  await open(context);
  // The server's answer to a registration in cookie transport: an access
  // token and no refresh token in the body. The worker's own session token
  // stands in for the new owner's; 14 minutes keeps it from being renewed.
  await registrations(context, (route) =>
    route.fulfill({
      status: 201,
      json: {
        accessToken: credentials.token,
        accessExpiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
      },
    }),
  );
  await page.goto('/');
  await page.getByTestId('email').fill(credentials.email);
  await page.getByTestId('password').fill(credentials.password);
  await page.getByTestId('confirm').fill(credentials.password);
  await page.getByTestId('register').click();
  await expect(count(page)).toBeVisible();
  await expect(page.getByTestId('register-form')).toHaveCount(0);
});
