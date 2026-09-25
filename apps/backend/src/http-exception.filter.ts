import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * express-openapi-validator rejects requests by throwing a plain error shaped
 * like { status, message, errors }, not a Nest HttpException. Nest's default
 * filter only reads status off HttpException, so every validator rejection —
 * a 400 on a bad body, a 404 on an undeclared route — would otherwise surface
 * as an unhandled 500. This reads status off either shape.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = this.statusOf(exception);
    const message = exception instanceof Error ? exception.message : 'Internal server error';
    response.status(status).json({ status, message });
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
}
