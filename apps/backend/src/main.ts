import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { json } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

const specPath = fileURLToPath(
  new URL('../../../packages/specs/openapi/openapi.yaml', import.meta.url),
);

async function bootstrap(): Promise<void> {
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

  const config = app.get(AppConfig);
  await app.listen(config.port);
}

void bootstrap();
