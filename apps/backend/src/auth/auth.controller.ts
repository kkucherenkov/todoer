import { Body, ConflictException, Controller, HttpCode, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { AuthService } from './auth.service.js';

type Credentials = { email: string; password: string };

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: Credentials) {
    return this.auth.login(body.email, body.password);
  }

  // Open registration: plan A has no owner-first or invitation gate (ADR
  // 0014's rules are plan D). Acceptable on a self-hosted local instance,
  // and load-bearing for Task 8's walking-skeleton.sh, which posts here.
  @Post('register')
  async register(@Body() body: Credentials): Promise<{ accessToken: string }> {
    const id = uuidv7();
    try {
      await this.auth.register(id, body.email, body.password);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('that address is already registered');
      }
      throw error;
    }
    return { accessToken: this.auth.sign(id) };
  }
}
