// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import type { PrismaClient } from '@prisma-clients/iam';
import { PERMISSIONS, expandDependencies } from '@ipms/authz';
import { hashPassword } from '../src/auth/password.js';
import { uuidv7 } from '@ipms/contracts';

const ALL = PERMISSIONS.map((p) => p.code);

/** Declared as intent; each set is closed over its dependencies before insert. */
const SYSTEM_ROLES: Array<{ code: string; name: string; description: string; permissions: string[] }> = [
  {
    code: 'SUPER_ADMIN', name: 'Super Administrator',
    description: 'Full system access. Cannot mutate the audit ledger — no such permission exists.',
    permissions: ALL,
  },
  {
    code: 'PROJECT_MANAGER', name: 'Project Manager',
    description: 'Runs projects: sites, milestones, task dispatch, and QC approval.',
    permissions: [
      'project.view', 'project.create', 'project.update', 'project.archive',
      'site.view', 'site.create', 'site.update',
      'milestone.view', 'milestone.create', 'milestone.update', 'milestone.declare',
      'task.view', 'task.create', 'task.update', 'task.assign', 'task.generate', 'task.cancel',
      'qc_template.view', 'qc_template.create', 'qc_template.update', 'qc_template.publish', 'qc_template.import',
      'qc_submission.view', 'qc_review.view', 'qc_review.approve', 'qc_review.reject',
      'qc_evidence.export', 'audit.view', 'user.view', 'scope.view',
    ],
  },
  {
    code: 'QC_MANAGER', name: 'QC Manager',
    description: 'Owns checklist templates and quality review. Can raise ad-hoc spot-check tasks.',
    permissions: [
      'project.view', 'site.view', 'milestone.view',
      'task.view', 'task.create', 'task.update', 'task.assign',
      'qc_template.view', 'qc_template.create', 'qc_template.update', 'qc_template.publish', 'qc_template.import',
      'qc_submission.view', 'qc_review.view', 'qc_review.approve', 'qc_review.reject',
      'qc_evidence.export', 'audit.view',
    ],
  },
  {
    code: 'FIELD_ENGINEER', name: 'Field Engineer',
    description: 'Executes assigned checklists and submits evidence. No approval authority by design.',
    permissions: [
      'project.view', 'site.view', 'task.view', 'task.update',
      'qc_template.view', 'qc_submission.view', 'qc_submission.create',
      'qc_submission.update', 'qc_submission.submit', 'qc_evidence.upload',
    ],
  },
  {
    code: 'VIEWER', name: 'Viewer',
    description: 'Read-only access to scoped projects.',
    permissions: ['project.view', 'site.view', 'milestone.view', 'task.view', 'qc_submission.view'],
  },
];

export async function seedIam(prisma: PrismaClient): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, action: p.action, description: p.description },
      create: { id: uuidv7(), code: p.code, module: p.module, action: p.action, description: p.description },
    });
  }

  for (const role of SYSTEM_ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description, isSystemRole: true },
      create: { id: uuidv7(), code: role.code, name: role.name, description: role.description, isSystemRole: true },
    });

    // Closing over dependencies guarantees no system role is logically broken.
    const codes = expandDependencies(role.permissions);
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });

    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: saved.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
}

const DEMO_USERS = [
  { username: 'admin',    email: 'admin@ipms.local',    fullName: 'System Administrator', role: 'SUPER_ADMIN' },
  { username: 'manager',  email: 'manager@ipms.local',  fullName: 'Project Manager',      role: 'PROJECT_MANAGER' },
  { username: 'qc',       email: 'qc@ipms.local',       fullName: 'QC Manager',           role: 'QC_MANAGER' },
  { username: 'engineer', email: 'engineer@ipms.local', fullName: 'Field Engineer',       role: 'FIELD_ENGINEER' },
];

/**
 * Development and E2E only. Creates four accounts, one per system role, all
 * sharing the password in `IAM_DEMO_PASSWORD`.
 *
 * Two deliberate choices here, both the opposite of the obvious one:
 *
 * The password has no default. A committed literal would put a known
 * SUPER_ADMIN credential in the repository, and `admin`/`demo12345` is the
 * first pair any scanner tries. Requiring the variable means a deployment that
 * forgets it gets a loud failure rather than a silent back door.
 *
 * The environment gate is an allowlist (`=== 'development'` or `'test'`), not
 * `!== 'production'`. The negated form is fail-open: `NODE_ENV` unset — the
 * default for a bare `node` or `docker compose` run — reads as "not
 * production" and seeds the accounts. An allowlist fails closed, so the
 * accounts appear only where they were asked for.
 */
export async function seedDemoUsers(prisma: PrismaClient): Promise<void> {
  const env = process.env['NODE_ENV'];
  if (env !== 'development' && env !== 'test') {
    throw new Error(
      `seedDemoUsers runs only with NODE_ENV=development or test (got ${env ?? 'unset'})`,
    );
  }

  const password = process.env['IAM_DEMO_PASSWORD'];
  if (!password) {
    throw new Error('IAM_DEMO_PASSWORD is not set; refusing to seed demo accounts with a default password');
  }

  const passwordHash = await hashPassword(password);

  for (const demo of DEMO_USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: demo.role } });
    const user = await prisma.user.upsert({
      where: { username: demo.username },
      update: {},
      create: {
        id: uuidv7(), username: demo.username, email: demo.email,
        fullName: demo.fullName, passwordHash, isActive: true,
      },
    });

    // `UserRole` carries no composite `@@unique`, on purpose — over nullable
    // `projectId`/`siteId` PostgreSQL treats every NULL as distinct, so the
    // composite would constrain nothing. The real guarantee is three partial
    // unique indexes in the migration, which Prisma cannot express as a
    // `where` key. So this cannot be an upsert: find the global assignment
    // explicitly, and create it only if absent.
    const existing = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId: role.id, projectId: null, siteId: null },
    });
    if (!existing) {
      await prisma.userRole.create({
        data: { id: uuidv7(), userId: user.id, roleId: role.id, createdBy: user.id },
      });
    }
  }
}
