import { AppConfig } from './config/app-config.js';
import { createApp } from './create-app.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  // Without this, onApplicationShutdown (PruneService's timer teardown) only
  // ever runs in tests, never on a real SIGTERM.
  app.enableShutdownHooks();
  await app.listen(app.get(AppConfig).port);
}

void bootstrap();
