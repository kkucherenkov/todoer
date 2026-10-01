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
 * When two cookies share the name, the first wins: browsers send the
 * longest path first.
 */
export function readRefreshCookie(
  header: string | undefined,
): string | undefined {
  for (const pair of header?.split(';') ?? []) {
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq).trim() === REFRESH_COOKIE) {
      return pair.slice(eq + 1).trim() || undefined;
    }
  }
  return undefined;
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
