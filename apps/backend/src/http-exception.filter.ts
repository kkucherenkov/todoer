import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';

interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

/**
 * express-openapi-validator rejects requests by throwing a plain error shaped
 * like { status, message, errors }, not a Nest HttpException. Nest's default
 * filter only reads status off HttpException, so every validator rejection —
 * a 400 on a bad body, a 404 on an undeclared route — would otherwise surface
 * as an unhandled 500. This reads status off either shape, and renders the
 * result as the RFC 9457 problem+json body the OpenAPI document's Problem
 * schema promises every client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Log the original object, not a reshaped copy, so whoever is on call
    // sees exactly what was thrown, stack included — this is the only place
    // that happens, since the response below never carries it for a 5xx.
    this.logger.error(
      exception,
      exception instanceof Error ? exception.stack : undefined,
    );

    const response = host.switchToHttp().getResponse<Response>();
    const status = this.statusOf(exception);
    const message = this.messageOf(exception);

    const problem: Problem = {
      type: 'about:blank',
      // Node's table always has an entry for every status this app produces.
      title: STATUS_CODES[status]!,
      status,
      // A 4xx describes what the caller did wrong, which the caller already
      // knows. A 5xx describes what went wrong inside — a Prisma constraint
      // naming a column, a connection error naming a host — which is never
      // the caller's business, so it never reaches the body.
      ...(status < 500 && message !== undefined ? { detail: message } : {}),
    };

    response.status(status).type('application/problem+json').json(problem);
  }

  private statusOf(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'status' in exception &&
      typeof exception.status === 'number'
    ) {
      return (exception as { status: number }).status;
    }
    return 500;
  }

  private messageOf(exception: unknown): string | undefined {
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'message' in exception &&
      typeof exception.message === 'string'
    ) {
      return (exception as { message: string }).message;
    }
    return undefined;
  }
}
