import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { SyncService } from '../sync/sync.service.js';
import { inProcessTransport } from './in-process-transport.js';

const request = { since: 0, ops: [] };
const stub = (sync: () => Promise<unknown>) => {
  const fn = vi.fn(sync);
  return { service: { sync: fn } as unknown as SyncService, fn };
};

describe('inProcessTransport', () => {
  it("answers 200 with the service's body", async () => {
    const body = { cursor: 3, results: [], changes: [] };
    const { service, fn } = stub(() => Promise.resolve(body));
    const response = await inProcessTransport(service, 'u1')(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    expect(fn).toHaveBeenCalledWith('u1', request);
  });

  it('a 400 from the service keeps its status', async () => {
    const { service: sync } = stub(() =>
      Promise.reject(new BadRequestException('bad since')),
    );
    const response = await inProcessTransport(sync, 'u1')(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      title: 'Bad Request',
      status: 400,
      detail: 'bad since',
    });
  });

  it('a throwing sync answers 500', async () => {
    const { service: sync } = stub(() => Promise.reject(new Error('db down')));
    const response = await inProcessTransport(sync, 'u1')(request);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('db down');
  });
});
