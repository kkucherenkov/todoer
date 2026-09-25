import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import * as OpenApiValidator from 'express-openapi-validator';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

const specPath = fileURLToPath(
  new URL('../../../packages/specs/openapi/openapi.yaml', import.meta.url),
);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new HttpExceptionFilter());

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
