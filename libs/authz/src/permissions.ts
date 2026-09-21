export interface PermissionDefinition {
  code: string;
  module: string;
  action: string;
  description: string;
  dependsOn: string[];
}

function def(module: string, action: string, description: string, dependsOn: string[] = []): PermissionDefinition {
  return { code: `${module}.${action}`, module, action, description, dependsOn };
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  // Identity and access
  def('user', 'view', 'View users'),
  def('user', 'create', 'Create users', ['user.view']),
  def('user', 'update', 'Update users', ['user.view']),
  def('user', 'deactivate', 'Deactivate users', ['user.view', 'user.update']),
  def('role', 'view', 'View roles'),
  def('role', 'create', 'Create roles', ['role.view', 'permission.view']),
  def('role', 'update', 'Update roles', ['role.view', 'permission.view']),
  def('role', 'delete', 'Delete non-system roles', ['role.view', 'role.update']),
  def('role', 'assign', 'Assign roles to users', ['role.view', 'user.view']),
  def('permission', 'view', 'View the permission catalog'),
  def('scope', 'view', 'View project and site access'),
  def('scope', 'grant', 'Grant project or site access', ['scope.view', 'user.view']),
  def('scope', 'revoke', 'Revoke project or site access', ['scope.view', 'user.view']),
  def('override', 'view', 'View permission overrides'),
  def('override', 'create', 'Create permission overrides', ['override.view', 'permission.view']),
  def('override', 'revoke', 'Revoke permission overrides', ['override.view']),
  def('access', 'simulate', 'Use the access simulator', ['user.view', 'permission.view']),


  // Projects
  def('project', 'view', 'View projects'),
  def('project', 'create', 'Create projects', ['project.view']),
  def('project', 'update', 'Update projects', ['project.view']),
  def('project', 'archive', 'Archive projects', ['project.view', 'project.update']),
  def('project', 'delete', 'Permanently delete a project', ['project.view', 'project.archive']),
  def('site', 'view', 'View sites', ['project.view']),
  def('site', 'create', 'Create sites', ['site.view']),
  def('site', 'update', 'Update sites', ['site.view']),
  def('site', 'delete', 'Delete sites', ['site.view', 'site.update']),
  def('site', 'import', 'Bulk-import sites from Excel', ['site.view', 'site.create', 'site.update']),
  def('milestone', 'view', 'View milestones', ['project.view']),
  def('milestone', 'create', 'Create milestones', ['milestone.view']),
  def('milestone', 'update', 'Update milestones', ['milestone.view']),
  def('milestone', 'declare', 'Declare a site milestone achieved', ['milestone.view']),

  // Tasks
  def('task', 'view', 'View tasks'),
  def('task', 'create', 'Create tasks', ['task.view']),
  def('task', 'update', 'Update tasks', ['task.view']),
  def('task', 'assign', 'Assign tasks to engineers', ['task.view', 'task.update']),
  def('task', 'generate', 'Bulk-generate tasks for a milestone scope', ['task.view', 'task.create']),
  def('task', 'cancel', 'Cancel a task', ['task.view', 'task.update']),
  def('task', 'delete', 'Delete a task', ['task.view', 'task.update']),

  // Quality control
  def('qc_template', 'view', 'View checklist templates'),
  def('qc_template', 'create', 'Create checklist templates', ['qc_template.view']),
  def('qc_template', 'update', 'Update draft templates', ['qc_template.view']),
  def('qc_template', 'publish', 'Enable a template', ['qc_template.view', 'qc_template.update']),
  def('qc_template', 'import', 'Import a template from Excel', ['qc_template.view', 'qc_template.create']),
  def('qc_submission', 'view', 'View submissions'),
  def('qc_submission', 'create', 'Start a submission', ['qc_submission.view']),
  def('qc_submission', 'update', 'Edit a draft submission', ['qc_submission.view']),
  def('qc_submission', 'submit', 'Submit for review', ['qc_submission.view', 'qc_submission.update']),
  def('qc_review', 'view', 'View submissions awaiting review', ['qc_submission.view']),
  def('qc_review', 'approve', 'Approve a submission', ['qc_review.view']),
  def('qc_review', 'reject', 'Reject a submission for rework', ['qc_review.view']),
  def('qc_evidence', 'upload', 'Upload photo evidence', ['qc_submission.view']),
  def('qc_evidence', 'export', 'Download a photo package', ['qc_submission.view']),

  // Audit — deliberately no update or delete. The ledger is append-only.
  def('audit', 'view', 'View the audit ledger'),
  def('audit', 'verify', 'Verify audit chain integrity', ['audit.view']),
] as const;

export const PERMISSION_CODES: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.code));

const BY_CODE = new Map(PERMISSIONS.map((p) => [p.code, p]));

/** Returns the input codes plus every transitive dependency. Cycle-safe. */
export function expandDependencies(codes: string[]): string[] {
  const result = new Set<string>();
  const visit = (code: string): void => {
    if (result.has(code)) return;
    result.add(code);
    for (const dep of BY_CODE.get(code)?.dependsOn ?? []) visit(dep);
  };
  for (const code of codes) visit(code);
  return [...result];
}

/** A role must not grant a permission without the permissions it depends on. */
export function validatePermissionSet(codes: string[]): { valid: boolean; missing: string[] } {
  const granted = new Set(codes);
  const missing = new Set<string>();
  for (const code of codes) {
    for (const dep of expandDependencies([code])) {
      if (dep !== code && !granted.has(dep)) missing.add(dep);
    }
  }
  return { valid: missing.size === 0, missing: [...missing] };
}
