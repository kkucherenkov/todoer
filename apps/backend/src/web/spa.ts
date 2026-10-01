import express, { type RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

// A <script> needs a hash when it has no type, `module`, or a JavaScript MIME
// type, and also when it is an `importmap` or `speculationrules` block:
// browsers apply script-src to those too. Nuxt's __NUXT_DATA__ payload is
// `application/json`: data, not script.
const HASHED =
  /^(?:module|importmap|speculationrules|(?:text|application)\/(?:java|ecma)script)?$/i;

/** CSP hashes of the inline scripts the build put into index.html. The
 *  browser hashes the exact text between the tags, which is what is hashed
 *  here. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, attrs = '', body = ''] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (/(^|\s)src\s*=/i.test(attrs) || body === '') continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? '';
    if (!HASHED.test(type)) continue;
    // HTML parsers turn CRLF and lone CR into LF before the script sees it.
    const text = body.replace(/\r\n?/g, '\n');
    hashes.push(
      `'sha256-${createHash('sha256').update(text).digest('base64')}'`,
    );
  }
  return hashes;
}

/**
 * ADR 0011: no inline script runs except the build's own, by hash (plan
 * departure 3). 'wasm-unsafe-eval' lets SQLite WASM compile (design Q12) and
 * allows no JavaScript eval. Inline style stays allowed: Nuxt UI writes its
 * theme into a <style> element at runtime, and CSS cannot run code
 * (departure 4). connect-src falls back to 'self': the API is same-origin
 * (Q9), so nothing else needs reaching.
 */
export function contentSecurityPolicy(html: string): string {
  return [
    "default-src 'self'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...inlineScriptHashes(html)].join(
      ' ',
    ),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Never the SPA's, whatever WEB_ROOT holds (design Q9). Lower-cased because
 *  Express routing is case-insensitive: /API/v1/health reaches Nest. */
const reserved = (path: string): boolean => {
  const p = path.toLowerCase();
  return ['/api', '/health'].some((r) => p === r || p.startsWith(`${r}/`));
};

/** Nuxt puts every content-hashed file under buildAssetsDir (`/_nuxt/`). */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Everything else (index.html, sw.js, the manifest) must be revalidated, or
 *  a client keeps an old app after an update. */
const REVALIDATE = 'no-cache';

export function spa(root: string): RequestHandler {
  // Read once: the policy's hashes always describe the bytes served, and
  // /index.html is served from this copy too. A new build requires a restart.
  const index = readFileSync(join(root, 'index.html'));
  const csp = contentSecurityPolicy(index.toString('utf8'));
  const hashed = join(root, '_nuxt') + sep;
  const files = express.static(root, {
    index: false, // `/` goes to the fallback, with its headers
    redirect: false, // no /dir → /dir/ redirect ahead of the fallback
    cacheControl: false,
    setHeaders: (res, path) => {
      // Workers take their policy from their own script's response, so every
      // file carries it, not only the document.
      res.setHeader('Content-Security-Policy', csp);
      res.setHeader(
        'Cache-Control',
        path.startsWith(hashed) ? IMMUTABLE : REVALIDATE,
      );
    },
  });
  const sendIndex = (res: Parameters<RequestHandler>[1]) =>
    res
      .set({ 'Content-Security-Policy': csp, 'Cache-Control': REVALIDATE })
      .type('html')
      .send(index);
  /** Whether static would resolve this path to index.html on disk. */
  const isIndex = (path: string): boolean => {
    try {
      return posix.normalize(decodeURIComponent(path)) === '/index.html';
    } catch {
      return false; // malformed escape: static answers it
    }
  };
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || reserved(req.path)) {
      return next();
    }
    if (isIndex(req.path)) return void sendIndex(res);
    files(req, res, (error?: unknown) => {
      if (error !== undefined) return next(error);
      // Only a navigation gets the app. A missing script or image asks for
      // */*, which req.accepts('html') would also accept, and must get its 404
      // (plan departure 5).
      if (!(req.headers.accept ?? '').includes('text/html')) return next();
      sendIndex(res);
    });
  };
}
