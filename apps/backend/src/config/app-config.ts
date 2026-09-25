import { Injectable } from '@nestjs/common';

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
