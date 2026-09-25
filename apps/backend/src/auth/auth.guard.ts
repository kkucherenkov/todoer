import {
  CanActivate, createParamDecorator, ExecutionContext,
  Injectable, UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      userId?: string;
    }>();
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    request.userId = this.auth.verify(header.slice('Bearer '.length));
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<{ userId?: string }>();
    if (request.userId === undefined) {
      throw new UnauthorizedException('no authenticated user');
    }
    return request.userId;
  },
);
