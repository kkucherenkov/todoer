import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
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
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = this.statusOf(exception);
    const message = this.messageOf(exception);

    const problem: Problem = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Internal Server Error',
      status,
      ...(message !== undefined ? { detail: message } : {}),
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
      typeof (exception as { status: unknown }).status === 'number'
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
      typeof (exception as { message: unknown }).message === 'string'
    ) {
      return (exception as { message: string }).message;
    }
    return undefined;
  }
}
