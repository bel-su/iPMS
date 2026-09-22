/**
 * Which roles an actor may confer on another user — the *object* gate, which
 * the permission catalog cannot express.
 *
 * "A project manager may create users" and "a project manager may not create an
 * administrator" are different statements, and `user.create` can only make the
 * first. Permissions stay the verb gate; this table answers which users a verb
 * may be aimed at.
 *
 * A role absent from this table confers no assignment authority at all. That is
 * the fail-closed direction and it is what makes a custom role created through
 * `RolesController` safe by default: it can be granted `user.create` and still
 * not be able to mint an administrator, because adding an entry here is a
 * separate, deliberate act.
 */
export const ROLE_ASSIGNMENT: Readonly<Record<string, readonly string[] | 'ALL'>> = {
  SUPER_ADMIN: 'ALL',
  PROJECT_MANAGER: ['FIELD_ENGINEER', 'QC_MANAGER'],
};

/** `'ALL'` for an unrestricted actor, otherwise the union of every listed role they hold. */
export function assignableRoles(actorRoleCodes: string[]): 'ALL' | Set<string> {
  const union = new Set<string>();
  for (const code of actorRoleCodes) {
    const entry = ROLE_ASSIGNMENT[code];
    if (entry === 'ALL') return 'ALL';
    for (const role of entry ?? []) union.add(role);
  }
  return union;
}

/** True when the actor may grant this role to someone. */
export function mayAssign(actorRoleCodes: string[], roleCode: string): boolean {
  const allowed = assignableRoles(actorRoleCodes);
  return allowed === 'ALL' || allowed.has(roleCode);
}

/**
 * True when the actor may edit, deactivate or re-role this target at all.
 *
 * Every one of the target's current roles must be assignable by the actor — so
 * a project manager cannot touch an administrator, because `SUPER_ADMIN` is not
 * in their set. A target holding no roles passes vacuously, which is intended;
 * see the table's comment.
 */
export function mayManage(actorRoleCodes: string[], targetRoleCodes: string[]): boolean {
  const allowed = assignableRoles(actorRoleCodes);
  if (allowed === 'ALL') return true;
  return targetRoleCodes.every((code) => allowed.has(code));
}
