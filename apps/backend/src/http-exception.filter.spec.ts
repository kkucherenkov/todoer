import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import {
  GoneException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
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
  let errorSpy: MockInstance<Logger['error']>;
  let warnSpy: MockInstance<Logger['warn']>;

  beforeEach(() => {
    // Every case here goes through catch(), which now always logs, at
    // `error` or `warn` depending on status. Stub both sinks so tests don't
    // spam stderr, and so the "must log" cases below have something to
    // assert against.
    errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
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

  // F10: a 410 is the protocol working as designed (a stale cursor), not an
  // operational problem — logging it at `error` with a stack pages whoever
  // is on call for something the client is expected to see routinely.
  it('logs a protocol-normal 4xx as a warning, not an error', () => {
    const filter = new HttpExceptionFilter();
    const { host } = createHost();

    filter.catch(
      new GoneException(
        'cursor 5 is older than the prune watermark 10; repeat with since 0',
      ),
      host,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      '410 cursor 5 is older than the prune watermark 10; repeat with since 0',
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
