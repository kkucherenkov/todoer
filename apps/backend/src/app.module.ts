import { Module } from '@nestjs/common';
import { AppConfig } from './config/app-config.js';
import { HealthController } from './health/health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [AppConfig],
})
export class AppModule {}
