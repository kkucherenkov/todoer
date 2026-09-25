import { Injectable } from '@nestjs/common';

/**
 * The only place in the application that reads process.env. Everything else
 * injects this, which is what makes configuration testable and keeps a typo in
 * a variable name from surfacing three layers deep at request time.
 */
@Injectable()
export class AppConfig {
  readonly port = Number(process.env.PORT ?? 3000);
  readonly version = process.env.APP_VERSION ?? '0.0.0-dev';
  readonly databaseUrl = this.required('DATABASE_URL');
  readonly jwtSecret = this.required('JWT_SECRET');

  private required(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is required`);
    }
    return value;
  }
}
