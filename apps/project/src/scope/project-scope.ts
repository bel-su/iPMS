import { scopeWhere, type AuthzScope, type ScopeWhere } from '@ipms/authz';

/**
 * The `where` fragment matching projects this caller may see.
 *
 * `scopeWhere` does not fit the Project model: Project scopes on its own `id`
 * and has no `siteId` column. A site grant reaches its project through the
 * `sites` relation instead, because project and site grants are alternatives --
 * a user scoped only to a site in project B must still see project B, or that
 * site is unreachable from every list that starts at a project.
 *
 * Used by every read and write that starts from a project. Do not inline a
 * copy: this is the definition of "visible project" for the whole service, and
 * copies of an authorization rule drift, with the drifted copy failing open.
 */
export function projectScope(scope: AuthzScope): Record<string, unknown> {
  if (scope.global) return {};
  return {
    OR: [
      { id: { in: scope.projectIds } },
      { sites: { some: { id: { in: scope.siteIds } } } },
    ],
  };
}

/** Projects visible to this caller, narrowed to one id. */
export function visibleProject(scope: AuthzScope, id: string): Record<string, unknown> {
  return { AND: [{ id }, projectScope(scope)] };
}

/**
 * A site is visible when the caller holds its project, or the site itself.
 *
 * Its own `id` plays the role of the site column -- Site has no `siteId`.
 */
export function siteScope(scope: AuthzScope): ScopeWhere {
  return scopeWhere(scope, { project: 'projectId', site: 'id' });
}

export function visibleSite(scope: AuthzScope, id: string): Record<string, unknown> {
  return { AND: [{ id }, siteScope(scope)] };
}

/** A task carries both foreign keys, so the default fields are correct. */
export function visibleTask(scope: AuthzScope, id: string): Record<string, unknown> {
  return { AND: [{ id }, scopeWhere(scope)] };
}

/**
 * Visibility for the project's own definition records -- task types and
 * milestones.
 *
 * Filtered through the `project` relation rather than on a `projectId` column,
 * even though they have one. A caller scoped only to a site would otherwise see
 * none of the task types or milestones belonging to that site's project, which
 * makes their own site's work unreadable: a field engineer could open a task
 * and not resolve the task type it names.
 */
export function viaProject(scope: AuthzScope): Record<string, unknown> {
  return { project: projectScope(scope) };
}

export function visibleViaProject(scope: AuthzScope, id: string): Record<string, unknown> {
  return { AND: [{ id }, viaProject(scope)] };
}
