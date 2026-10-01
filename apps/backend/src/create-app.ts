import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { json } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { AppConfig, applyTrustProxy } from './config/app-config.js';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { spa } from './web/spa.js';

const specPath = fileURLToPath(
  new URL('../../../packages/specs/openapi/openapi.yaml', import.meta.url),
);

/** The application with its whole HTTP chain, not yet listening. main.ts and
 *  create-app.spec.ts both build it here, so the spec runs the real order. */
export async function createApp(
  overrides: { webRoot?: string } = {},
): Promise<INestApplication> {
  // Nest's built-in body parser is registered by app.listen()/init(), which
  // runs after every app.use() call below — so with the default bodyParser,
  // express-openapi-validator would read req.body before anything ever
  // populated it, and reject every POST with "must have required property
  // 'body'". Parsing JSON ourselves, ahead of the validator, is what makes
  // req.body exist by the time it (and @Body()) read it.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = app.get(AppConfig);
  // The SPA passes on everything under /api and /health, every non-GET, and
  // every non-navigation it has no file for. The validator only ever manages
  // /api/v1 (its base path), so static paths are never validated and the
  // SPA's position relative to it does not matter; it goes first so a static
  // request never reaches the body parser. The order that does matter is the
  // body parser before the validator (trap 3), which create-app.spec.ts pins.
  const webRoot = overrides.webRoot ?? config.webRoot;
  if (webRoot !== undefined) app.use(spa(webRoot));

  // express.json() defaults to a 100kb limit. The contract allows up to
  // 1000 ops per sync batch; even a minimal delete op is ~105 bytes, so a
  // full batch of those alone is already ~105kb — a client back from a week
  // offline would get a 413 for a request the contract calls legal. 2mb is
  // comfortably above that floor.
  app.use(json({ limit: '2mb' }));
  app.use(
    OpenApiValidator.middleware({
      apiSpec: specPath,
      validateRequests: true,
      validateResponses: true,
      // Authentication is enforced by Nest guards (Task 7). Leaving this on
      // would make the validator reject before the guard runs, which turns a
      // 401 into a 500 and hides which layer refused.
      validateSecurity: false,
    }),
  );

  // Per-IP rate limits key on req.ip, which behind a reverse proxy is the
  // proxy's address unless told otherwise. See README, "Environment".
  applyTrustProxy(app, config);
  return app;
}
