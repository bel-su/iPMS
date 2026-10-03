/**
 * What the topbar search looks in, decided by where the viewer already is: on
 * Users it finds users, in the Checklist library it finds checklists, and so
 * on. Pages without a list of their own fall back to work orders, the record
 * people look up most.
 */
export interface SearchScope {
  /** The list page the form submits to. */
  action: string;
  /** The query parameter that list page reads. */
  field: string;
  placeholder: string;
  /** Filters on that list page the search must not discard — a template tab, a user status. */
  keep: readonly string[];
}

const WORK_ORDERS: SearchScope = {
  action: '/quality/work-orders', field: 'q', placeholder: 'Search work orders…', keep: ['view', 'status', 'projectId', 'workOrderType'],
};

const SCOPES: readonly { prefix: string; scope: SearchScope }[] = [
  { prefix: '/quality/work-orders', scope: WORK_ORDERS },
  { prefix: '/quality/templates', scope: { action: '/quality/templates', field: 'q', placeholder: 'Search checklists…', keep: ['tab', 'category'] } },
  { prefix: '/users', scope: { action: '/users', field: 'search', placeholder: 'Search users…', keep: ['status', 'role'] } },
  { prefix: '/projects', scope: { action: '/projects', field: 'q', placeholder: 'Search projects…', keep: [] } },
];

export function searchScope(pathname: string): SearchScope {
  const hit = SCOPES.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit?.scope ?? WORK_ORDERS;
}
