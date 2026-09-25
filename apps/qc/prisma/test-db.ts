import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/qc';

export async function startTestDb(): Promise<{ prisma: PrismaClient; connectionString: string; stop(): Promise<void> }> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // fileURLToPath, not URL.pathname: the latter can stay percent-encoded on macOS.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return {
    prisma,
    connectionString,
    async stop() { await prisma.$disconnect(); await container.stop(); },
  };
}
