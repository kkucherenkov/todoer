import { Module } from '@nestjs/common';
import { AccountsService } from './auth/accounts.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { SessionService } from './auth/session.service.js';
import { AppConfig } from './config/app-config.js';
import { EngineController } from './engine/engine.controller.js';
import { EngineHub } from './engine/engine-hub.js';
import { HealthController } from './health/health.controller.js';
import { PrismaService } from './prisma/prisma.service.js';
import { ChangeFeed } from './sync/change-feed.js';
import { PruneService } from './sync/prune.service.js';
import { SyncController } from './sync/sync.controller.js';
import { SyncService } from './sync/sync.service.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    SyncController,
    EngineController,
  ],
  providers: [
    AppConfig,
    PrismaService,
    ChangeFeed,
    SyncService,
    PruneService,
    AuthService,
    AccountsService,
    SessionService,
    AuthGuard,
    EngineHub,
  ],
})
export class AppModule {}
