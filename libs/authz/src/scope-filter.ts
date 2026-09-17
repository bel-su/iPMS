import type { AuthzScope } from './types.js';

export interface ScopeWhere {
  projectId?: { in: string[] };
  siteId?: { in: string[] };
}

/**
 * Prisma `where` fragment constraining a query to the user's scope.
 * Spread into every list query: `where: { ...scopeWhere(scope), status: 'ONGOING' }`.
 * A global user gets `{}`; a user with no scope gets `{ projectId: { in: [] } }`, which matches nothing.
 */
export function scopeWhere(scope: AuthzScope): ScopeWhere {
  if (scope.global) return {};
  const where: ScopeWhere = { projectId: { in: scope.projectIds } };
  if (scope.siteIds.length > 0) where.siteId = { in: scope.siteIds };
  return where;
}
