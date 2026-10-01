import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, inlineScriptHashes } from './spa.js';

const hash = (text: string) =>
  `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

const NUXT_CONFIG = 'window.__NUXT__={};window.__NUXT__.config={baseURL:"/"}';

describe('inlineScriptHashes', () => {
  it('hashes only the executable inline script of a Nuxt-shaped page', () => {
    const html = `<html><head>
      <script type="module" src="/_nuxt/entry.js"></script>
      </head><body>
      <script type="application/json" id="__NUXT_DATA__">[{"a":1}]</script>
      <script>${NUXT_CONFIG}</script>
      </body></html>`;
    expect(inlineScriptHashes(html)).toEqual([hash(NUXT_CONFIG)]);
  });

  it('hashes text/javascript and an unquoted module type', () => {
    const html = `<script type="text/javascript">a()</script><script type=module>b()</script>`;
    expect(inlineScriptHashes(html)).toEqual([hash('a()'), hash('b()')]);
  });

  it('hashes an inline import map and speculation rules, not other data', () => {
    const map = '{"imports":{"a":"/a.js"}}';
    const rules = '{"prefetch":[]}';
    const html = `<script type="importmap">${map}</script><script type="speculationrules">${rules}</script><script type="application/ld+json">{}</script>`;
    expect(inlineScriptHashes(html)).toEqual([hash(map), hash(rules)]);
  });

  it('does not mistake data-src for src', () => {
    expect(inlineScriptHashes('<script data-src="x">a()</script>')).toEqual([
      hash('a()'),
    ]);
    expect(inlineScriptHashes('<script src="x">a()</script>')).toEqual([]);
  });

  it('hashes the body with CRLF and CR normalised to LF', () => {
    expect(inlineScriptHashes('<script>a()\r\nb()\rc()</script>')).toEqual([
      hash('a()\nb()\nc()'),
    ]);
  });

  it('skips an empty inline script', () => {
    expect(inlineScriptHashes('<script></script>')).toEqual([]);
  });

  it('keeps document order', () => {
    expect(
      inlineScriptHashes('<script>two()</script><script>one()</script>'),
    ).toEqual([hash('two()'), hash('one()')]);
  });
});

describe('contentSecurityPolicy', () => {
  it('carries the hashes and no unsafe-inline in script-src', () => {
    const csp = contentSecurityPolicy('<script>x()</script>');
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toBe(
      `script-src 'self' 'wasm-unsafe-eval' ${hash('x()')}`,
    );
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
