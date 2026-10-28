import {
  Body,
  Controller,
  Get,
  HttpCode,
  type OnModuleDestroy,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Command } from '@todoer/client-core';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { EngineHub } from './engine-hub.js';

/** Nginx Proxy Manager drops a read idle for 60 s; a comment keeps it open. */
const PING_MS = 25_000;

/** The web's engine: commands in, topics out. The validator has already
 *  refused anything that is not an `EngineRequest` (no signIn, register or
 *  signOut). */
@Controller({ path: 'engine', version: '1' })
@UseGuards(AuthGuard)
export class EngineController implements OnModuleDestroy {
  /** Ends each open stream: the HTTP server's close waits for them. */
  private readonly open = new Set<() => void>();

  constructor(
    private readonly hub: EngineHub,
    private readonly auth: AuthService,
  ) {}

  onModuleDestroy(): void {
    for (const end of this.open) end();
  }

  @Post()
  @HttpCode(200)
  request(
    @CurrentUser() userId: string,
    @Body() body: { tab: string; id: number; command: Command },
  ) {
    return this.hub.request(userId, body.tab, body.id, body.command);
  }

  /** Written to the raw response: the response validator only reads what
   *  goes through `res.json`, so the streamed body never meets it. */
  @Get('events')
  events(
    @CurrentUser() userId: string,
    @Query('tab') tab: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    // First, so a token that expired since the guard registers nothing.
    // The stream lives no longer than the bearer; the page reconnects with
    // a renewed one.
    const { expiresAt } = this.auth.verifyWithExpiry(
      (req.headers.authorization ?? '').slice('bearer '.length),
    );
    // Before the head too: once it is written, a refusal is no longer a 401.
    this.hub.assertLive(userId);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      // Nginx would otherwise buffer the stream and hold every event back.
      'x-accel-buffering': 'no',
    });
    const close = this.hub.open(
      userId,
      tab,
      (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
      () => end(),
    );
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    const expiry = setTimeout(() => end(), expiresAt.getTime() - Date.now());
    const end = () => {
      if (!this.open.delete(end)) return;
      clearInterval(ping);
      clearTimeout(expiry);
      close();
      res.end();
    };
    this.open.add(end);
    req.on('close', end);
  }
}
