import type { TokenSource } from './auth.js';
import type { Config } from './config.js';
import type { Transport } from './sync.js';

/** POST /sync over fetch, bounded by the configured timeout. A 401 renews the
 *  token once and resends with the new one. */
export function httpTransport(config: Config, tokens: TokenSource): Transport {
  const post = (body: string, token: string) =>
    fetch(`${config.base}/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
      },
      body,
      // The whole exchange, body included: a server that accepts the
      // connection and never answers is as unreachable as one that refuses it.
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  return async (request) => {
    const body = JSON.stringify(request);
    const token = await tokens.current();
    const response = await post(body, token);
    if (response.status !== 401) return response;
    // Resending the token that was just refused cannot change the answer.
    const renewed = await tokens.renew();
    if (renewed === null || renewed === token) return response;
    return post(body, renewed);
  };
}
