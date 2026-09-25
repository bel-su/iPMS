import { NotFoundException, ForbiddenException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import type { AssignableUser, SiteRefs } from '@ipms/contracts';

export type Lookup<T> =
  | { state: 'found'; value: T }
  | { state: 'not_found' }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

/** The lookup as an answer, or the HTTP error that stands in for one. */
export function required<T>(lookup: Lookup<T>, what: string): T {
  switch (lookup.state) {
    case 'found': return lookup.value;
    case 'not_found': throw new NotFoundException(`${what} not found`);
    case 'forbidden': throw new ForbiddenException(`You cannot view this ${what.toLowerCase()}`);
    case 'unavailable': throw new ServiceUnavailableException('The project service could not be reached. Try again shortly.');
  }
}

/**
 * What qc needs to know from project: who can see what, which sites a project
 * has, and who can be given work in it.
 *
 * Every call forwards the caller's own bearer token, so project answers with
 * the caller's own permissions and scope and no shared service secret is
 * needed. None of them degrade: without the caller's scope there is no safe
 * list to show, and without the sites or the assignee's reach there is no
 * valid work order to save.
 */
export class ProjectDirectoryClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  /** The caller's replicated scope, as project resolves it for its own queries. */
  scope(bearer: string): Promise<Lookup<AuthzScope>> {
    return this.call<AuthzScope>('/api/v1/internal/scope', bearer);
  }

  /** The project and those of `siteIds` in it that the caller can see. */
  siteRefs(projectId: string, siteIds: string[], bearer: string): Promise<Lookup<SiteRefs>> {
    return this.call<SiteRefs>(`/api/v1/internal/projects/${projectId}/site-refs`, bearer, { siteIds });
  }

  /** Everyone whose scope reaches the project, and how far. */
  assignable(projectId: string, bearer: string): Promise<Lookup<AssignableUser[]>> {
    return this.call<AssignableUser[]>(`/api/v1/projects/${projectId}/assignable`, bearer);
  }

  private async call<T>(path: string, bearer: string, body?: unknown): Promise<Lookup<T>> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: bearer, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) return { state: 'not_found' };
      if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
      if (response.status === 400) throw new BadRequestException((await response.json().catch(() => ({})) as { message?: string }).message ?? 'The project service refused the request');
      if (!response.ok) return { state: 'unavailable' };
      return { state: 'found', value: (await response.json()) as T };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      return { state: 'unavailable' };
    }
  }
}
