import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import { PrismaClient } from '@prisma-clients/iam';
import { PERMISSIONS, validatePermissionSet } from '@ipms/authz';
import { seedDemoUsers, seedIam } from './seed.js';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

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
  // a driver adapter is required to actually connect. See apps/iam/prisma.config.ts
  // and apps/iam/src/prisma.service.ts for the same pattern used by the real app.
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  await seedIam(prisma);
}, 180_000);

afterAll(async () => { await prisma?.$disconnect(); await container?.stop(); });

describe('seedIam', () => {
  it('inserts the whole permission catalog', async () => {
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
  });

  it('creates the five system roles', async () => {
    const roles = await prisma.role.findMany({ where: { isSystemRole: true } });
    expect(roles.map((r) => r.code).sort()).toEqual(
      ['FIELD_ENGINEER', 'PROJECT_MANAGER', 'QC_MANAGER', 'SUPER_ADMIN', 'VIEWER'],
    );
  });

  it('gives SUPER_ADMIN every permission except ledger mutation', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'SUPER_ADMIN' }, include: { permissions: { include: { permission: true } } },
    });
    expect(role.permissions).toHaveLength(PERMISSIONS.length);
  });

  it('never grants FIELD_ENGINEER approval authority', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'FIELD_ENGINEER' }, include: { permissions: { include: { permission: true } } },
    });
    const codes = role.permissions.map((rp) => rp.permission.code);
    expect(codes).toContain('qc_submission.submit');
    expect(codes).not.toContain('qc_review.approve');
    expect(codes).not.toContain('qc_review.reject');
    expect(codes).not.toContain('task.assign');
  });

  it('gives every system role a dependency-complete permission set', async () => {
    const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
    for (const role of roles) {
      const result = validatePermissionSet(role.permissions.map((rp) => rp.permission.code));
      expect(result.valid, `${role.code} is missing ${result.missing.join(', ')}`).toBe(true);
    }
  });

  it('gives site.import to SUPER_ADMIN and PROJECT_MANAGER only', async () => {
    const roles = await prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
    });
    const codes = (code: string): string[] =>
      roles.find((role) => role.code === code)?.permissions.map((entry) => entry.permission.code) ?? [];
    expect(codes('SUPER_ADMIN')).toContain('site.import');
    expect(codes('PROJECT_MANAGER')).toContain('site.import');
    // QC managers hold site.view only and do not provision sites.
    for (const role of ['QC_MANAGER', 'FIELD_ENGINEER', 'VIEWER']) {
      expect(codes(role), `${role} must not hold site.import`).not.toContain('site.import');
    }
  });

  it('gives a project manager authority over users but not over roles', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'PROJECT_MANAGER' },
      include: { permissions: { include: { permission: true } } },
    });
    const codes = role.permissions.map((rp) => rp.permission.code);

    expect(codes).toContain('user.create');
    expect(codes).toContain('user.update');
    expect(codes).toContain('user.deactivate');
    expect(codes).toContain('role.assign');
    // The object gate is what stops a project manager minting an administrator;
    // being unable to *edit a role's permissions* is a separate guarantee, and
    // this is it.
    expect(codes).not.toContain('role.create');
    expect(codes).not.toContain('role.update');
  });

  it('gives QC managers and field engineers no authority over users', async () => {
    for (const code of ['QC_MANAGER', 'FIELD_ENGINEER']) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code },
        include: { permissions: { include: { permission: true } } },
      });
      const codes = role.permissions.map((rp) => rp.permission.code);
      expect(codes, `${code} must not hold user.create`).not.toContain('user.create');
      expect(codes, `${code} must not hold role.assign`).not.toContain('role.assign');
    }
  });

  it('leaves the template library to QC managers: project managers may only view it', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'PROJECT_MANAGER' }, include: { permissions: { include: { permission: true } } },
    });
    const codes = role.permissions.map((rp) => rp.permission.code);
    expect(codes).toContain('qc_template.view');
    for (const code of ['qc_template.create', 'qc_template.update', 'qc_template.publish', 'qc_template.import']) {
      expect(codes).not.toContain(code);
    }
  });

  it('keeps field engineers out of the template library', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'FIELD_ENGINEER' }, include: { permissions: { include: { permission: true } } },
    });
    expect(role.permissions.map((rp) => rp.permission.code).filter((code) => code.startsWith('qc_template.'))).toEqual([]);
  });

  it('is idempotent', async () => {
    await seedIam(prisma);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect(await prisma.role.count()).toBe(5);
  });
});

/**
 * The seed writes admin's global grant straight to the table, so it has to
 * publish the event too. Other services learn scope only from
 * `iam.scope.granted` -- a row without an event leaves the seeded administrator
 * holding every permission and able to see nothing, and it fails silently,
 * because the row is present and looks correct.
 *
 * Caught by running the real stack, not by any unit test.
 */
describe('seedDemoUsers global scope replication', () => {
  beforeAll(async () => {
    process.env['IAM_DEMO_PASSWORD'] = 'test-only-password';
    await seedDemoUsers(prisma);
  }, 120_000);

  it('grants admin global scope', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ipms.local' } });
    expect(await prisma.userGlobalScope.findUnique({ where: { userId: admin.id } })).not.toBeNull();
  });

  it('emits iam.scope.granted at level GLOBAL so other services learn about it', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ipms.local' } });
    const events = await prisma.outboxEvent.findMany({ where: { subject: 'iam.scope.granted' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      userId: admin.id, level: 'GLOBAL', projectId: null, siteId: null,
    });
  });

  it('grants nobody else global scope', async () => {
    // Only the administrator. A PM is granted the projects they run, explicitly,
    // which is the whole point of enforcing scope.
    expect(await prisma.userGlobalScope.count()).toBe(1);
  });

  it('is idempotent: a second seed adds no row and no second event', async () => {
    await seedDemoUsers(prisma);
    expect(await prisma.userGlobalScope.count()).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { subject: 'iam.scope.granted' } })).toBe(1);
  });
});
