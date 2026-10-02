import { describe, expect, it, vi } from 'vitest';
import { registrationOpen } from './registration';

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('registrationOpen', () => {
  it('asks the status route', async () => {
    const fetcher = vi.fn(answer(200, { open: true }));
    expect(await registrationOpen(fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/auth/registration',
      expect.anything(),
    );
  });

  it.each([
    ['closed', answer(200, { open: false })],
    ['a refusal', answer(500, { open: true })],
    ['a body without open', answer(200, {})],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>'))],
    ['a network error', () => Promise.reject(new TypeError('offline'))],
  ])('%s → false: the sign-in form', async (_, fetcher) => {
    expect(await registrationOpen(fetcher)).toBe(false);
  });
});
