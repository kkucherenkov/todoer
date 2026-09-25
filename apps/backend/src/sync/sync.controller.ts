import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { SyncRequest } from '@todoer/specs';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { SyncService } from './sync.service.js';

@Controller({ path: 'sync', version: '1' })
@UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly service: SyncService) {}

  // Nest defaults a POST handler to 201; the contract declares 200 for a
  // successful sync. Every operation now has a `default: Problem` response
  // too, so an undeclared status no longer crashes the validator — it would
  // instead fail response validation against Problem's shape, since a bare
  // { cursor, results, changes } body isn't one.
  @Post()
  @HttpCode(200)
  sync(@CurrentUser() userId: string, @Body() body: SyncRequest) {
    return this.service.sync(userId, body);
  }
}
