import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './create-app.js';
import { PrismaService } from './prisma/prisma.service.js';
import { resetDatabase } from './testing/reset-database.js';

const prisma = new PrismaService();
let app: INestApplication;
let base: string;

const get = (path: string, accept = 'application/json') =>
  fetch(`${base}${path}`, { headers: { accept } });
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await resetDatabase(prisma);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('createApp: the real middleware chain over HTTP', () => {
  it('serves GET /api/v1/health as JSON', async () => {
    const res = await get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('lets a well-formed login body reach the controller (401, not 400)', async () => {
    // Trap 3: a 400 here means the body parser runs after the validator.
    const res = await post('/api/v1/auth/login', {
      email: 'nobody@example.com',
      password: 'correct horse battery staple',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );
  });

  it('rejects a login body missing its fields with 400 from the validator', async () => {
    const res = await post('/api/v1/auth/login', {});
    expect(res.status).toBe(400);
  });

  it('serves nothing at / without WEB_ROOT', async () => {
    const res = await get('/', 'text/html');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );
  });

  describe('the refresh cookie', () => {
    const PASSWORD = 'correct horse battery!1';
    let cookie: string;
    let access: string;

    const attributes = (res: Response): string[] => {
      const [header] = res.headers.getSetCookie();
      return (header ?? '').split('; ');
    };
    const valueOf = (res: Response): string =>
      attributes(res)[0]!.replace('todoer_refresh=', '');

    it('register with transport cookie sets the cookie and keeps the token out of the body', async () => {
      const res = await post('/api/v1/auth/register', {
        email: 'owner@example.com',
        password: PASSWORD,
        transport: 'cookie',
      });
      expect(res.status).toBe(201);
      const text = await res.text();
      expect(text).not.toContain('refreshToken');
      const attrs = attributes(res);
      expect(res.headers.getSetCookie()).toHaveLength(1);
      expect(attrs[0]).toMatch(/^todoer_refresh=[^;\s]+$/);
      expect(attrs).toEqual(
        expect.arrayContaining([
          'Max-Age=2592000',
          'Path=/api/v1/auth',
          'HttpOnly',
          'Secure',
          'SameSite=Strict',
        ]),
      );
      expect(attrs.some((a) => a.startsWith('Expires='))).toBe(true);
      expect(text).not.toContain(valueOf(res));
      cookie = `todoer_refresh=${valueOf(res)}`;
    });

    it('refreshes from the cookie alone and rotates it', async () => {
      const res = await post('/api/v1/auth/refresh', {}, { cookie });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).not.toHaveProperty('refreshToken');
      access = json.accessToken as string;
      expect(res.headers.getSetCookie()).toHaveLength(1);
      expect(valueOf(res)).not.toBe(cookie.split('=')[1]);
      cookie = `todoer_refresh=${valueOf(res)}`;
    });

    it('logout clears the cookie at the same path and ends the session', async () => {
      const res = await post(
        '/api/v1/auth/logout',
        {},
        { authorization: `Bearer ${access}`, cookie },
      );
      expect(res.status).toBe(204);
      const attrs = attributes(res);
      expect(attrs[0]).toBe('todoer_refresh=');
      expect(attrs).toContain('Path=/api/v1/auth');
      const expires = attrs.find((a) => a.startsWith('Expires='))!;
      expect(new Date(expires.slice('Expires='.length)).getFullYear()).toBe(
        1970,
      );
      const again = await post('/api/v1/auth/refresh', {}, { cookie });
      expect(again.status).toBe(401);
    });
  });
});

describe('createApp: serving a built SPA from WEB_ROOT', () => {
  const SCRIPT = 'window.__NUXT__={config:{}}';
  const INDEX = `<!doctype html><html><body><script>${SCRIPT}</script></body></html>`;
  const HASH = `'sha256-${createHash('sha256').update(SCRIPT).digest('base64')}'`;
  const IMMUTABLE = 'public, max-age=31536000, immutable';
  let webRoot: string;
  let spaApp: INestApplication;
  let spaBase: string;
  const seen: Response[] = [];

  const web = async (
    path: string,
    init: RequestInit = {},
    accept = 'text/html',
  ) => {
    const res = await fetch(`${spaBase}${path}`, {
      ...init,
      headers: { accept, ...(init.headers as Record<string, string>) },
    });
    seen.push(res);
    return res;
  };
  const problem = (res: Response) => {
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );
  };

  beforeAll(async () => {
    webRoot = mkdtempSync(join(tmpdir(), 'spa-'));
    mkdirSync(join(webRoot, '_nuxt'));
    mkdirSync(join(webRoot, 'api'));
    writeFileSync(join(webRoot, 'index.html'), INDEX);
    writeFileSync(join(webRoot, '_nuxt/app.abc123.js'), 'console.log(1)');
    writeFileSync(join(webRoot, 'sw.js'), 'self.skip=1');
    writeFileSync(join(webRoot, 'api/secret.txt'), 'secret');
    spaApp = await createApp({ webRoot });
    await spaApp.listen(0, '127.0.0.1');
    spaBase = `http://127.0.0.1:${((spaApp.getHttpServer() as Server).address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await spaApp.close();
    rmSync(webRoot, { recursive: true });
    // 9: the API's origin is its own, so no CORS header on anything above.
    for (const res of seen) {
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('serves index.html at / with its own CSP hash and no-cache', async () => {
    const res = await web('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(INDEX);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain(`script-src 'self' 'wasm-unsafe-eval' ${HASH}`);
  });

  it('falls back to index.html for a page route, GET and HEAD', async () => {
    const res = await web('/tasks/123');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    const head = await web('/tasks/123', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('never answers /api or /health with the app', async () => {
    const health = await web('/api/v1/health');
    expect(health.headers.get('content-type')).toContain('application/json');
    expect(await health.json()).toMatchObject({ status: 'ok' });
    problem(await web('/API/v1/nope'));
    problem(await web('/api'));
    problem(await web('/health'));
  });

  it('does not serve a file under WEB_ROOT/api', async () => {
    problem(await web('/api/secret.txt', {}, '*/*'));
  });

  it('does not swallow a POST', async () => {
    problem(
      await web('/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
  });

  it('404s a missing asset that did not ask for html', async () => {
    problem(await web('/_nuxt/missing.js', {}, '*/*'));
  });

  it('caches hashed assets forever and everything else by revalidation', async () => {
    const asset = await web('/_nuxt/app.abc123.js', {}, '*/*');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(asset.headers.get('content-security-policy')).toContain(HASH);
    const sw = await web('/sw.js', {}, '*/*');
    expect(sw.status).toBe(200);
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('still lets a well-formed login body reach the controller (trap 3)', async () => {
    const res = await fetch(`${spaBase}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'nobody@example.com',
        password: 'correct horse battery staple',
      }),
    });
    seen.push(res);
    expect(res.status).toBe(401);
  });
});
