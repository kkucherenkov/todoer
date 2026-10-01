import express, { type RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// A <script> runs when it has no type, `module`, or a JavaScript MIME type.
// Nuxt's __NUXT_DATA__ payload is `application/json`: data, not script.
const EXECUTABLE = /^(?:module|(?:text|application)\/(?:java|ecma)script)?$/i;

/** CSP hashes of the inline scripts the build put into index.html. The
 *  browser hashes the exact text between the tags, which is what is hashed
 *  here. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, attrs = '', body = ''] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (/\bsrc\s*=/i.test(attrs) || body === '') continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? '';
    if (!EXECUTABLE.test(type)) continue;
    hashes.push(
      `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
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
  // Read once: the policy's hashes always describe the bytes served. A new
  // build means a new image, so a restart.
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
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || reserved(req.path)) {
      return next();
    }
    files(req, res, (error?: unknown) => {
      if (error !== undefined) return next(error);
      // Only a navigation gets the app. A missing script or image asks for
      // */*, which req.accepts('html') would also accept, and must get its 404
      // (plan departure 5).
      if (!(req.headers.accept ?? '').includes('text/html')) return next();
      res
        .set({ 'Content-Security-Policy': csp, 'Cache-Control': REVALIDATE })
        .type('html')
        .send(index);
    });
  };
}
