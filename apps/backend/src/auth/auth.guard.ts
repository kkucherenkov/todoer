import {
  CanActivate, createParamDecorator, ExecutionContext,
  Injectable, UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

// RFC 7235's scheme name ("Bearer") is case-insensitive. Same message as
// every other rejection here, so a missing header, a wrong scheme, a
// malformed token, a bad signature and an expired token are all one 401 to
// the client — see auth.service.ts's INVALID_TOKEN for why.
const BEARER_PREFIX = 'bearer ';
const INVALID_TOKEN = 'invalid token';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      userId?: string;
    }>();
    const header = request.headers.authorization;
    if (header === undefined || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
    request.userId = this.auth.verify(header.slice(BEARER_PREFIX.length));
    return true;
  }
}

// Exported separately from the decorator so it can be unit-tested directly,
// against a bare { userId } object, without going through Nest's parameter
// pipeline.
export function currentUserFactory(_data: unknown, context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest<{ userId?: string }>();
  if (request.userId === undefined) {
    throw new UnauthorizedException('no authenticated user');
  }
  return request.userId;
}

export const CurrentUser = createParamDecorator(currentUserFactory);
