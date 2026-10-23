import { NestFactory } from '@nestjs/core';
import { expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { ChangeFeed } from './sync/change-feed.js';
import { SyncService } from './sync/sync.service.js';

it('hands SyncService the module’s single ChangeFeed', async () => {
  process.env.JWT_SECRET ??= 'x'.repeat(32);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    expect(app.get(SyncService)['feed']).toBe(app.get(ChangeFeed));
  } finally {
    await app.close();
  }
});
