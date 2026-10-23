import { HttpException, Logger } from '@nestjs/common';
import type { Transport } from '@todoer/client-core';
import { STATUS_CODES } from 'node:http';
import type { SyncService } from '../sync/sync.service.js';

const logger = new Logger('InProcessTransport');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A client-core `Transport` that calls `SyncService.sync` directly, for an
 * engine running inside the backend. Errors map as the HTTP filter would:
 * an `HttpException` keeps its status and message, anything else is a 500
 * with no detail.
 */
export function inProcessTransport(
  sync: SyncService,
  userId: string,
): Transport {
  return async (request) => {
    try {
      return json(200, await sync.sync(userId, request));
    } catch (e) {
      if (e instanceof HttpException) {
        const status = e.getStatus();
        return json(status, {
          type: 'about:blank',
          title: STATUS_CODES[status],
          status,
          detail: e.message,
        });
      }
      logger.error(e, e instanceof Error ? e.stack : undefined);
      return json(500, {
        type: 'about:blank',
        title: STATUS_CODES[500],
        status: 500,
      });
    }
  };
}
