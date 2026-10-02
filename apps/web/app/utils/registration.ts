/**
 * Whether the instance takes a registration without an invitation (its first
 * account, the owner). Anything but a clear yes is a no: the sign-in form is
 * the screen to fall back to.
 */
export async function registrationOpen(
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher('/api/v1/auth/registration', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { open?: unknown };
    return body.open === true;
  } catch {
    return false;
  }
}
