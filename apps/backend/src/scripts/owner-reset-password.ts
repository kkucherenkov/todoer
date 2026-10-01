import { PrismaService } from '../prisma/prisma.service.js';
import { issueResetCode } from '../auth/accounts.service.js';

// Run on the host: `pnpm --filter @todoer/backend run owner:reset-password`.
// Needs DATABASE_URL only. AppConfig is avoided on purpose: it demands
// JWT_SECRET, which the code issuer never uses, and the script only needs Prisma.
const prisma = new PrismaService();
try {
  const owner = await prisma.user.findFirst({ where: { isOwner: true } });
  if (owner === null) {
    console.error('no owner exists on this instance');
    process.exitCode = 1;
  } else {
    const code = await issueResetCode(prisma, owner.id);
    console.log(`reset code (valid 15 minutes): ${code}`);
    console.log(
      `curl -X POST "$TODOER_URL/auth/reset" -H 'content-type: application/json' ` +
        `-d '{"code":"${code}","password":"<new password>"}'`,
    );
  }
} finally {
  await prisma.$disconnect();
}
