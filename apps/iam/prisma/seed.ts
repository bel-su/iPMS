// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import type { PrismaClient } from '.prisma-client-iam';
import { PERMISSIONS, expandDependencies } from '@ipms/authz';
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
      'project.view', 'project.create', 'project.update',
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
