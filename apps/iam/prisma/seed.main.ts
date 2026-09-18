/**
 * Seed entrypoint, run by `pnpm --filter iam seed` (and by the E2E stack
 * before it logs in). `seedIam` is always safe — it only reconciles the
 * permission catalog and the system roles. `seedDemoUsers` creates real
 * credentials, so it runs only when explicitly asked for by an allowlisted
 * NODE_ENV and with IAM_DEMO_PASSWORD supplied; see its doc comment.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '.prisma-client-iam';
import { seedIam, seedDemoUsers } from './seed.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Prisma 7 has no connection-string wiring left on the client constructor; a
// driver adapter is required. IAM_DATABASE_URL, not DATABASE_URL — the latter
// belongs to the Prisma CLI's migration tooling (see prisma.config.ts).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('IAM_DATABASE_URL') }),
});

async function main(): Promise<void> {
  await seedIam(prisma);

  const env = process.env['NODE_ENV'];
  if (env === 'development' || env === 'test') {
    await seedDemoUsers(prisma);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
