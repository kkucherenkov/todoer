import {
  expect,
  request,
  type APIRequestContext,
  type FullConfig,
} from '@playwright/test';

export type Tokens = { accessToken: string; refreshToken: string };

const OWNER = {
  email: process.env.OWNER_EMAIL ?? 'owner@example.test',
  password: process.env.OWNER_PASSWORD ?? 'correct horse 9 battery!',
};
export const PASSWORD = 'correct horse 9 battery!';

/**
 * POST to the API. A 429 names the limit it hit: the server counts every
 * login and registration per IP (20 per 15 minutes each) and every failed
 * refresh (30), and a run that spends them should say so instead of timing
 * out somewhere later.
 */
export async function post(
  api: APIRequestContext,
  path: string,
  data: object,
  bearer?: string,
) {
  const response = await api.post(`/api/v1${path}`, {
    data,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  if (response.status() === 429) {
    throw new Error(
      `POST ${path} answered 429: its per-IP limit is spent; restart the backend`,
    );
  }
  return response;
}

/** The owner's access token: registered on an empty instance, else logged in. */
async function ownerToken(api: APIRequestContext): Promise<string> {
  let response = await post(api, '/auth/register', OWNER);
  if (response.status() !== 201) {
    response = await post(api, '/auth/login', OWNER);
    expect(response.status(), 'owner login').toBe(200);
  }
  return ((await response.json()) as Tokens).accessToken;
}

/**
 * The fresh-user.sh flow, once per run: one account per project, handed to
 * that project's workers through E2E_ACCOUNTS (fixtures.ts). The suite's
 * registrations are fixed here, however many tests there are.
 */
export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0]!.use;
  const api = await request.newContext({ ...(baseURL && { baseURL }) });
  const owner = await ownerToken(api);
  const accounts: Record<string, string> = {};
  for (const { name } of config.projects) {
    const invite = await post(api, '/auth/invites', {}, owner);
    expect(invite.status(), 'invitation').toBe(201);
    const { token: invitation } = (await invite.json()) as { token: string };
    const email = `e2e-${name}-${Date.now()}@example.test`;
    const registered = await post(api, '/auth/register', {
      email,
      password: PASSWORD,
      invitation,
    });
    expect(registered.status(), `registration for ${name}`).toBe(201);
    accounts[name] = email;
  }
  await api.dispose();
  process.env.E2E_ACCOUNTS = JSON.stringify(accounts);
}
