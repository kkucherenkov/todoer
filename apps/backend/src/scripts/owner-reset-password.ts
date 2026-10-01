import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from '../auth/accounts.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { SessionService } from '../auth/session.service.js';

// Run on the host: `pnpm --filter @todoer/backend run owner:reset-password`.
// Needs DATABASE_URL only. AppConfig is avoided on purpose: it demands
// JWT_SECRET, which issueResetCode never uses, and the script only needs Prisma.
const prisma = new PrismaService();
try {
  const owner = await prisma.user.findFirst({ where: { isOwner: true } });
  if (owner === null) {
    console.error('no owner exists on this instance');
    process.exitCode = 1;
  } else {
    // issueResetCode touches only Prisma, so the other two are never called.
    const accounts = new AccountsService(
      prisma,
      undefined as unknown as AuthService,
      undefined as unknown as SessionService,
    );
    const code = await accounts.issueResetCode(owner.id);
    console.log(`reset code (valid 15 minutes): ${code}`);
    console.log(
      `curl -X POST "$TODOER_URL/auth/reset" -H 'content-type: application/json' ` +
        `-d '{"code":"${code}","password":"<new password>"}'`,
    );
  }
} finally {
  await prisma.$disconnect();
}
