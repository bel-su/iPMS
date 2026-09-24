import type { AuthzScope } from './types.js';

/**
 * Which columns on the queried model carry the owning project and site.
 *
 * `null` means the model has no such column. Naming one anyway produces an
 * invalid Prisma query rather than a stricter one, so the caller has to say.
 */
export interface ScopeFields {
  project: string | null;
  site: string | null;
}

/** Site, Task and anything else carrying both foreign keys. */
export const DEFAULT_SCOPE_FIELDS: ScopeFields = { project: 'projectId', site: 'siteId' };

export type ScopeWhere = Record<string, unknown>;

/**
 * Prisma `where` fragment constraining a query to the user's scope.
 *
 * Spread into a list query: `where: { ...scopeWhere(scope), status: 'ONGOING' }`.
 * Prisma ANDs top-level keys, so the spread composes. A caller that needs its
 * *own* `OR` must nest instead — `where: { AND: [scopeWhere(scope), { OR: [...] }] }`
 * — or the two `OR` keys collide and one is silently dropped.
 *
 * Project and site grants are ALTERNATIVES. A user scoped to project A and
 * additionally to one site in project C can see all of A and that one site. An
 * earlier version ANDed the two clauses, which matched nothing at all for
 * exactly that user: every project-A row failed the site test, and the site-C
 * row failed the project test. No service noticed because none of them called
 * this function.
 *
 * A user with no scope produces `{ OR: [{ projectId: { in: [] } }, { siteId: { in: [] } }] }`,
 * which matches nothing. That is deliberate and load-bearing: an empty scope
 * projection is indistinguishable from "this user was granted nothing", and
 * denying is the only safe reading of both.
 */
export function scopeWhere(scope: AuthzScope, fields: ScopeFields = DEFAULT_SCOPE_FIELDS): ScopeWhere {
  if (scope.global) return {};

  const alternatives: ScopeWhere[] = [];
  if (fields.project !== null) alternatives.push({ [fields.project]: { in: scope.projectIds } });
  if (fields.site !== null) alternatives.push({ [fields.site]: { in: scope.siteIds } });

  // A model carrying neither column cannot be scoped at all. Denying is the
  // only safe answer; returning `{}` would hand a non-global user every row.
  if (alternatives.length === 0) return { id: { in: [] } };

  return { OR: alternatives };
}
