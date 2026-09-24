import type { AuthzScope, ScopeProvider } from '@ipms/authz';
import type { UserScopeRepository } from './user-scope.repository.js';

/**
 * Supplies `AuthzGuard` with the caller's replicated scope.
 *
 * Unlike iam's provider, this one does real work. `project` owns project- and
 * site-scoped resources and every list query constrains itself with
 * `scopeWhere(scope)`, so a stub here would disable the platform's actual
 * authorization boundary rather than merely returning an unread value.
 */
export function projectScopeProvider(repo: UserScopeRepository): ScopeProvider {
  return {
    async for(userId: string): Promise<AuthzScope> {
      return repo.scopeFor(userId);
    },
  };
}
