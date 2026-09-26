import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from './store.js';
import { flush } from './sync.js';
import { httpTransport } from './transport.js';

let server: Server | undefined;
let store: Store | undefined;

afterEach(async () => {
  store?.close();
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
  }
  server = store = undefined;
});

describe('httpTransport', () => {
  // FR-011: a server that accepts the connection and never answers is as
  // unreachable as one that refuses it.
  it('gives up on a server that never answers', async () => {
    server = createServer(() => {});
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    store = Store.open(':memory:');
    const send = httpTransport({
      base: `http://127.0.0.1:${port}`,
      token: '',
      dbPath: ':memory:',
      timeoutMs: 200,
    });

    const started = Date.now();
    const flushed = await flush(store, send);

    expect(flushed.synced).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  }, 3000);
});
