import 'server-only';
import type { ApiResult } from '../lib/api-client';
import { getCurrentUser, hasPermission, type CurrentUser } from '../lib/iam-api';
import { listWorkOrders, type WorkOrder, type WorkOrderFilter } from '../lib/project-api';
import { listUserDirectory } from '../lib/user-api';
import type { WorkOrderPage } from '@ipms/contracts';
import { isWorkOrderType, personLabel, queueFilter } from './labels';
import { QUEUE_PAGE_SIZE, type QueueParams } from './queue';

export type QueueSearch = { filter?: string; projectId?: string; type?: string; mine?: string; q?: string; page?: string; created?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the queue's URL into a list query and fetches it, with the names the rows show. */
export async function loadQueue(search: QueueSearch): Promise<{
  params: QueueParams;
  result: ApiResult<WorkOrderPage<WorkOrder>>;
  viewer: ApiResult<CurrentUser>;
  names: Map<string, string>;
  created: number | undefined;
  may: (permission: string) => boolean;
}> {
  const filter = queueFilter(search.filter);
  const viewer = await getCurrentUser();
  const projectId = search.projectId && UUID.test(search.projectId) ? search.projectId : undefined;
  const params: QueueParams = {
    filter: filter.key,
    projectId,
    type: isWorkOrderType(search.type) ? search.type : undefined,
    mine: search.mine === '1',
    q: search.q?.trim().slice(0, 100) || undefined,
    page: Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1),
  };
  const query: WorkOrderFilter = {
    ...filter.query,
    projectId: params.projectId,
    workOrderType: params.type,
    assigneeId: params.mine && viewer.state === 'ready' ? viewer.data.id : undefined,
    q: params.q,
    page: params.page,
    limit: QUEUE_PAGE_SIZE,
  };
  const [result, people] = await Promise.all([listWorkOrders(query), listUserDirectory()]);
  const created = Number.parseInt(search.created ?? '', 10);
  return {
    params, result, viewer,
    names: new Map(people.state === 'ready' ? people.data.map((person) => [person.id, personLabel(person)]) : []),
    created: Number.isFinite(created) && created > 0 ? created : undefined,
    may: (permission) => viewer.state === 'ready' && hasPermission(viewer.data, permission),
  };
}
