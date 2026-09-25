import type { WorkOrder } from '@prisma-clients/qc';

export type WorkOrderRow = WorkOrder;

export const OPEN = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'];
export const CLOSED = ['COMPLETED', 'CANCELLED'];

/**
 * A work order as the API returns it: with its site and project as nested
 * objects, the shape the queue has always rendered. The copies taken when it
 * was raised stand in for project's own records.
 */
export function toView(row: WorkOrderRow) {
  const { projectCode, projectName, siteCode, siteName, siteCity, siteArea, ...rest } = row;
  return {
    ...rest,
    site: { id: row.siteId, siteCode, name: siteName, city: siteCity, area: siteArea },
    project: { id: row.projectId, code: projectCode, name: projectName },
  };
}
