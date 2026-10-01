import { Injectable, type INestApplication } from '@nestjs/common';
import type { Application } from 'express';

/**
 * The only place in the application that reads process.env. Everything else
 * injects this, which is what makes configuration testable and keeps a typo in
 * a variable name from surfacing three layers deep at request time.
 */
@Injectable()
export class AppConfig {
  readonly port = this.portNumber('PORT', 3000);
  readonly version = process.env.APP_VERSION ?? '0.0.0-dev';
  readonly databaseUrl = this.required('DATABASE_URL');
  readonly jwtSecret = this.required('JWT_SECRET');
  readonly trustProxy = this.proxyTrust('TRUST_PROXY');

  /**
   * Express's `trust proxy` setting: a hop count or a list of addresses and
   * subnets, or undefined to trust nothing. `true` is refused on purpose: it
   * trusts every hop, so any client could forge X-Forwarded-For and dodge the
   * per-IP rate limits.
   */
  private proxyTrust(name: string): number | string | undefined {
    const raw = process.env[name]?.trim();
    if (!raw) return undefined;
    if (/^\d+$/.test(raw)) return Number(raw);
    // Anything that reads as one number but not a whole count (-1, 1.5), and
    // the booleans express would accept, are not an address list. A dotted
    // quad is an address and has more than one dot.
    if (/^[-+]?\d*\.?\d+$/.test(raw) || /^(true|false)$/i.test(raw)) {
      throw new Error(
        `${name} must be a hop count or a list of addresses/subnets`,
      );
    }
    return raw;
  }

  /**
   * A port, or a refusal. `Number('abc')` is NaN and `listen(NaN)` binds a
   * random free port, so a typo used to produce a server that started, passed
   * its own health check, and answered on a port nothing else in the
   * deployment knew about. The same reasoning as `required` below: a
   * misconfiguration should fail where it is written, not three layers deep.
   */
  private portNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      throw new Error(
        `${name} must be a whole number between 0 and 65535, not ${raw}`,
      );
    }
    return value;
  }

  private required(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is required`);
    }
    return value;
  }
}

/** Wires `TRUST_PROXY` into express; see the README for what to set. */
export function applyTrustProxy(
  app: INestApplication,
  config: Pick<AppConfig, 'trustProxy'>,
): void {
  if (config.trustProxy === undefined) return;
  (app.getHttpAdapter().getInstance() as Application).set(
    'trust proxy',
    config.trustProxy,
  );
}
