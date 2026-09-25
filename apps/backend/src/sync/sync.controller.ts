import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { SyncService } from './sync.service.js';

@Controller({ path: 'sync', version: '1' })
@UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly service: SyncService) {}

  // Nest defaults a POST handler to 201; the contract declares 200 for a
  // successful sync, and express-openapi-validator's response validator
  // 500s on a status it has no schema for.
  @Post()
  @HttpCode(200)
  sync(@CurrentUser() userId: string, @Body() body: { since: number; ops: [] }) {
    return this.service.sync(userId, body as never);
  }
}
