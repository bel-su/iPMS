import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import { PrismaClient } from '@prisma-clients/iam';
import { uuidv7 } from '@ipms/contracts';

/**
 * Proves the fix for the `UserRole` duplicate-grant hazard: PostgreSQL treats
 * NULL as never equal to NULL in a unique index, so a single composite
 * `@@unique([userId, roleId, projectId, siteId])` (as `schema.prisma` declared
 * before this fix) only ever rejects duplicates for the fully site-scoped shape
 * and silently accepts unlimited duplicate global or project-scoped grants. The
 * fix replaces it with three hand-written partial unique indexes in this
 * model's migration.sql (`user_role_global_uidx`, `user_role_project_uidx`,
 * `user_role_site_uidx`) — see the comments on the `UserRole` model and in that
 * migration for the full explanation.
 */

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let userId: string;
let roleId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // `new URL(..., import.meta.url).pathname` can come back percent-encoded on macOS
    // when the path contains URL-escaped characters; fileURLToPath decodes correctly.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  // Prisma ORM 7 removed `datasources`/`datasourceUrl` from the client constructor;
  // a driver adapter is required to actually connect. See apps/iam/prisma.config.ts.
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });

  userId = uuidv7();
  roleId = uuidv7();
  await prisma.user.create({
    data: {
      id: userId,
      email: 'unique-test-user@example.com',
      fullName: 'Unique Test User',
      passwordHash: 'not-a-real-hash',
    },
  });
  await prisma.role.create({
    data: { id: roleId, name: 'Unique Test Role', code: 'UNIQUE_TEST_ROLE' },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.userRole.deleteMany({ where: { userId } });
});

async function grant(overrides: { projectId?: string; siteId?: string } = {}) {
  return prisma.userRole.create({
    data: {
      id: uuidv7(),
      userId,
      roleId,
      createdBy: userId,
      projectId: overrides.projectId ?? null,
      siteId: overrides.siteId ?? null,
    },
  });
}

describe('user_role partial unique indexes', () => {
  it('rejects a duplicate global assignment (projectId and siteId both NULL)', async () => {
    await grant();
    await expect(grant()).rejects.toThrow();
  });

  it('rejects a duplicate project-scoped assignment (siteId NULL)', async () => {
    const projectId = uuidv7();
    await grant({ projectId });
    await expect(grant({ projectId })).rejects.toThrow();
  });

  it('rejects a duplicate site-scoped assignment', async () => {
    const siteId = uuidv7();
    await grant({ projectId: uuidv7(), siteId });
    await expect(grant({ projectId: uuidv7(), siteId })).rejects.toThrow();
  });

  it('allows a global and a project-scoped assignment of the same user+role to coexist', async () => {
    await grant();
    await expect(grant({ projectId: uuidv7() })).resolves.toBeDefined();
    expect(await prisma.userRole.count({ where: { userId, roleId } })).toBe(2);
  });
});
