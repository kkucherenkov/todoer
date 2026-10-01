import type { Response } from 'express';
import { IDLE_MS } from './session.service.js';

export const REFRESH_COOKIE = 'todoer_refresh';
/** Global prefix + URI version + the auth controller: the browser sends the
 *  cookie to the auth routes and nowhere else (ADR 0011, W1 amendment). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export type CookieJar = Pick<Response, 'cookie' | 'clearCookie'>;

const ATTRIBUTES = {
  httpOnly: true,
  // Unconditional, not req.secure: behind a TLS-terminating proxy the request
  // arrives as plain HTTP, and a cookie that dropped Secure there would travel
  // in clear text the moment anyone reached the backend directly.
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
} as const;

/**
 * One cookie by name. A request's Cookie header is only `name=value` pairs
 * separated by `;`, so this is the part of cookie-parser this code would use.
 * The token's alphabet (hex, digits, `-`, `.`, base64url) needs no decoding.
 * A duplicated name reads as absent: a same-site sibling can set a second
 * cookie with a longer Path, and picking either one would let it plant its
 * own token (login CSRF).
 */
export function readRefreshCookie(
  header: string | undefined,
): string | undefined {
  const values: string[] = [];
  for (const pair of header?.split(';') ?? []) {
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq).trim() === REFRESH_COOKIE) {
      values.push(pair.slice(eq + 1).trim());
    }
  }
  return values.length === 1 ? values[0] || undefined : undefined;
}

export function setRefreshCookie(res: CookieJar, token: string): void {
  // The cookie lives as long as an idle session; each rotation extends both.
  res.cookie(REFRESH_COOKIE, token, { ...ATTRIBUTES, maxAge: IDLE_MS });
}

export function clearRefreshCookie(res: CookieJar): void {
  // Express 5 writes Expires=1970, which clears it as Max-Age=0 would. Only
  // a clear with the same Path reaches the cookie it means.
  res.clearCookie(REFRESH_COOKIE, ATTRIBUTES);
}
