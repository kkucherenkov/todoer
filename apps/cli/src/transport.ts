import type { Config } from './config.js';
import type { Transport } from './sync.js';

/** POST /sync over fetch, bounded by the configured timeout. */
export function httpTransport(config: Config): Transport {
  return (request) =>
    fetch(`${config.base}/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(request),
      // The whole exchange, body included: a server that accepts the
      // connection and never answers is as unreachable as one that refuses it.
      signal: AbortSignal.timeout(config.timeoutMs),
    });
}
