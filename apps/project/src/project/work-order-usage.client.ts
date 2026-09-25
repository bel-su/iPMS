import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Asks qc how many work orders a project or site still has, forwarding the
 * deleting user's own token.
 *
 * Fails closed: if qc cannot answer, the delete is refused. A deleted site
 * with work orders still assigned to it is data loss nobody can see.
 */
export class WorkOrderUsageClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  async count(filter: { projectId: string } | { siteId: string }, bearer: string): Promise<number> {
    const query = 'projectId' in filter ? `projectId=${filter.projectId}` : `siteId=${filter.siteId}`;
    try {
      const response = await globalThis.fetch(`${this.baseUrl}/api/v1/internal/work-orders/usage?${query}`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) return ((await response.json()) as { count: number }).count;
    } catch {
      // Falls through to the refusal below.
    }
    throw new ServiceUnavailableException('The QC service could not confirm this has no work orders. Try again shortly.');
  }
}
