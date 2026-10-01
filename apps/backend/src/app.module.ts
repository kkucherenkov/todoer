import { Module } from '@nestjs/common';
import { AccountsService } from './auth/accounts.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { SessionService } from './auth/session.service.js';
import { AppConfig } from './config/app-config.js';
import { HealthController } from './health/health.controller.js';
import { PrismaService } from './prisma/prisma.service.js';
import { PruneService } from './sync/prune.service.js';
import { SyncController } from './sync/sync.controller.js';
import { SyncService } from './sync/sync.service.js';

@Module({
  controllers: [HealthController, AuthController, SyncController],
  providers: [
    AppConfig,
    PrismaService,
    SyncService,
    PruneService,
    AuthService,
    AccountsService,
    SessionService,
    AuthGuard,
  ],
})
export class AppModule {}
