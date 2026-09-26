import { homedir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from './protocol.js';

export type Config = {
  base: string;
  token: string;
  dbPath: string;
  timeoutMs: number;
};

/**
 * The only reader of the environment. A bad value is a usage error here, at
 * startup, rather than a request that waits forever or not at all.
 */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const raw = env.TODOER_TIMEOUT_MS;
  const timeoutMs = raw === undefined || raw === '' ? 3000 : Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new UsageError(
      `TODOER_TIMEOUT_MS must be a positive whole number of milliseconds, not ${String(raw)}`,
    );
  }
  return {
    base: env.TODOER_URL ?? 'http://localhost:3000/api/v1',
    token: env.TODOER_TOKEN ?? '',
    dbPath: join(env.HOME ?? homedir(), '.config', 'todoer', 'todoer.db'),
    timeoutMs,
  };
}
