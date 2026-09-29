import { getJson, type Lookup } from './lookup.js';

export interface WorkOrderRef { id: string; projectId: string; siteId: string; siteCode: string; status: string }

/** Evidence may only be added while the work order is still being worked. */
export const OPEN_WORK_ORDER: readonly string[] = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'];

/**
 * Reads a work order through qc's own endpoint with the caller's token, so qc
 * applies the caller's permission and scope: a work order the engineer cannot
 * see is one they cannot upload evidence for.
 */
export class QcClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  async workOrder(id: string, bearer: string): Promise<Lookup<WorkOrderRef>> {
    const lookup = await getJson<{ id: string; projectId: string; siteId: string; status: string; site: { siteCode: string } }>(
      `${this.baseUrl}/api/v1/work-orders/${id}`, bearer, this.timeoutMs,
    );
    if (lookup.state !== 'found') return lookup;
    const { value } = lookup;
    return { state: 'found', value: { id: value.id, projectId: value.projectId, siteId: value.siteId, siteCode: value.site.siteCode, status: value.status } };
  }
}
