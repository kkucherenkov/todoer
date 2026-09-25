import { Module } from '@nestjs/common';
import { AppConfig } from './config/app-config.js';
import { HealthController } from './health/health.controller.js';
import { PrismaService } from './prisma/prisma.service.js';
import { SyncService } from './sync/sync.service.js';

@Module({
  controllers: [HealthController],
  providers: [AppConfig, PrismaService, SyncService],
})
export class AppModule {}
