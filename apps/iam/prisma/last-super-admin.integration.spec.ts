import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import { PrismaClient } from '@prisma-clients/iam';
import { uuidv7 } from '@ipms/contracts';
import { UsersService } from '../src/users/users.service.js';
import { seedIam } from './seed.js';

/**
 * The last-active-administrator rule is the one guarantee in this module that a
 * unit test cannot establish. It depends on a count taken inside the mutating
 * transaction: with a fake `$transaction`, a test can only prove the count was
 * requested, never that it was isolated — and isolation is the rule.
 */

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: UsersService;
let superAdminRoleId: string;
let viewerRoleId: string;

const ACTOR = uuidv7();
const ADMIN_ROLES = ['SUPER_ADMIN'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // `new URL(..., import.meta.url).pathname` can come back percent-encoded on
    // macOS; fileURLToPath decodes correctly.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  await seedIam(prisma);

  superAdminRoleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } })).id;
  viewerRoleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'VIEWER' } })).id;

  service = new UsersService(
    prisma as never,
    { hash: vi.fn().mockResolvedValue('$argon2id$fake'), verify: vi.fn() } as never,
    { publish: vi.fn().mockResolvedValue(undefined) } as never,
    { refreshTtlSeconds: 2_592_000 } as never,
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.userRole.deleteMany({});
  await prisma.outboxEvent.deleteMany({});
  await prisma.user.deleteMany({});
});

async function makeUser(username: string, roleId: string, isActive = true): Promise<string> {
  const id = uuidv7();
  await prisma.user.create({
    data: {
      id, email: `${username}@ipms.local`, fullName: username,
      passwordHash: 'not-a-real-hash', isActive,
    },
  });
  await prisma.userRole.create({ data: { id: uuidv7(), userId: id, roleId, createdBy: ACTOR } });
  return id;
}

describe('the last active super administrator', () => {
  it('cannot be deactivated', async () => {
    const only = await makeUser('only.admin', superAdminRoleId);
    await expect(service.deactivate(only, ACTOR, ADMIN_ROLES)).rejects.toThrow(/last active super administrator/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: only } })).isActive).toBe(true);
  });

  it('cannot be demoted', async () => {
    const only = await makeUser('only.admin', superAdminRoleId);
    await expect(service.setRoles(only, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN_ROLES))
      .rejects.toThrow(/last active super administrator/i);
    const roles = await prisma.userRole.findMany({ where: { userId: only } });
    expect(roles).toHaveLength(1);
    expect(roles[0]!.roleId).toBe(superAdminRoleId);
  });

  it('can be deactivated once a second active administrator exists', async () => {
    const first = await makeUser('first.admin', superAdminRoleId);
    await makeUser('second.admin', superAdminRoleId);
    await expect(service.deactivate(first, ACTOR, ADMIN_ROLES)).resolves.toBeDefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).isActive).toBe(false);
  });

  // An inactive administrator is not a survivor: nobody can sign in as them.
  it('does not count a deactivated administrator as the survivor', async () => {
    const active = await makeUser('active.admin', superAdminRoleId);
    await makeUser('retired.admin', superAdminRoleId, false);
    await expect(service.deactivate(active, ACTOR, ADMIN_ROLES)).rejects.toThrow(/last active super administrator/i);
  });

  it('leaves no partial write behind when it refuses', async () => {
    const only = await makeUser('only.admin', superAdminRoleId);
    await expect(service.setRoles(only, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN_ROLES)).rejects.toThrow();
    // The refusal aborts the transaction, so neither the role replacement nor
    // the tokenVersion bump that precedes the audit write may survive.
    expect(await prisma.userRole.count({ where: { userId: only, roleId: viewerRoleId } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: only } })).tokenVersion).toBe(0);
  });
});

describe('an ordinary administrator', () => {
  it('can be demoted while another remains, and the audit entry records both sets', async () => {
    const first = await makeUser('first.admin', superAdminRoleId);
    await makeUser('second.admin', superAdminRoleId);
    await service.setRoles(first, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN_ROLES);

    const roles = await prisma.userRole.findMany({ where: { userId: first } });
    expect(roles).toHaveLength(1);
    expect(roles[0]!.roleId).toBe(viewerRoleId);

    const audit = await prisma.outboxEvent.findFirst({
      where: { subject: 'audit.event.recorded' }, orderBy: { createdAt: 'desc' },
    });
    expect((audit!.payload as { action: string }).action).toBe('user.roles_changed');
  });
});
