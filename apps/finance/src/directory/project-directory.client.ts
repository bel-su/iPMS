import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import type { ProjectRef } from '../common.js';

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
 * What finance needs from project: the caller's project scope, and a project's
 * code and name to snapshot onto a request.
 *
 * Every call forwards the caller's own bearer token, so project answers with
 * the caller's own permissions and no shared secret is needed. Neither call
 * degrades: with no scope there is no safe list to show.
 */
export class ProjectDirectoryClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  scope(bearer: string): Promise<Lookup<AuthzScope>> {
    return this.call('/api/v1/internal/scope', bearer, (body) => body as AuthzScope);
  }

  project(projectId: string, bearer: string): Promise<Lookup<ProjectRef>> {
    return this.call(`/api/v1/projects/${projectId}`, bearer, (body) => {
      const { id, code, name } = body as ProjectRef;
      return { id, code, name };
    });
  }

  private async call<T>(path: string, bearer: string, pick: (body: unknown) => T): Promise<Lookup<T>> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) return { state: 'not_found' };
      if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
      if (!response.ok) return { state: 'unavailable' };
      return { state: 'found', value: pick(await response.json()) };
    } catch {
      return { state: 'unavailable' };
    }
  }
}
