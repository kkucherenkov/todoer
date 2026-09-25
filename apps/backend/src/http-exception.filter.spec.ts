import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';

function createHost() {
  const response = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('HttpExceptionFilter', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Every case here goes through catch(), which now always logs. Stub the
    // sink so tests don't spam stderr, and so the "must log" case below has
    // something to assert against.
    errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a validator rejection as an RFC 9457 problem+json body', () => {
    const filter = new HttpExceptionFilter();
    const { host, response } = createHost();

    filter.catch({ status: 404, message: 'not found' }, host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'not found',
    });
  });

  it('keeps the message for a 4xx HttpException', () => {
    const filter = new HttpExceptionFilter();
    const { host, response } = createHost();

    filter.catch(new NotFoundException('task 123 not found'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'task 123 not found',
    });
  });

  it('never leaks an internal 5xx message into the response body', () => {
    const filter = new HttpExceptionFilter();
    const { host, response } = createHost();
    const exception = new Error('connection to db-host:5432 refused');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [body] = response.json.mock.calls[0] as [Record<string, unknown>];
    expect(body).toMatchObject({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('db-host');
    expect(JSON.stringify(body)).not.toContain(exception.message);
  });

  it('still logs the original exception when it hides it from the response', () => {
    const filter = new HttpExceptionFilter();
    const { host } = createHost();
    const exception = new Error('connection to db-host:5432 refused');

    filter.catch(exception, host);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [loggedException] = errorSpy.mock.calls[0] as [unknown];
    expect(loggedException).toBe(exception);
  });
});
