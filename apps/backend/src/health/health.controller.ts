import { Controller, Get } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly config: AppConfig) {}

  @Get()
  get(): { status: 'ok'; version: string } {
    return { status: 'ok', version: this.config.version };
  }
}
