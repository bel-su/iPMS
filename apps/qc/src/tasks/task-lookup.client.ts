import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export interface TaskRef {
  id: string; projectId: string; siteId: string;
  assigneeId: string | null; templateId: string | null; status: string;
}

export type TaskLookup =
  | { state: 'found'; task: TaskRef }
  | { state: 'not_found' }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

/**
 * Forwards the caller's own bearer token, so project checks their permission
 * and no shared service secret is needed. Unlike the geofence lookup, a failure
 * cannot degrade gracefully: without the task there is no authorization decision.
 */
export class TaskLookupClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  async fetch(taskId: string, bearer: string): Promise<TaskLookup> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}/api/v1/internal/tasks/${taskId}`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) return { state: 'not_found' };
      if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
      if (!response.ok) return { state: 'unavailable' };
      return { state: 'found', task: (await response.json()) as TaskRef };
    } catch {
      return { state: 'unavailable' };
    }
  }
}

/** The lookup as an answer or the HTTP error that stands in for one. */
export function requireTask(lookup: TaskLookup): TaskRef {
  switch (lookup.state) {
    case 'found': return lookup.task;
    case 'not_found': throw new NotFoundException('Task not found');
    case 'forbidden': throw new ForbiddenException('You cannot view this task');
    case 'unavailable': throw new ServiceUnavailableException('The project service could not be reached. Try again shortly.');
  }
}
