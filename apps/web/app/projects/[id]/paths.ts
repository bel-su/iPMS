export type ProjectTab = 'overview' | 'sites' | 'setup';

/** The project's pages, one per tab. Kept free of JSX so server actions can import it. */
export const PROJECT_TABS: readonly { tab: ProjectTab; label: string; path: string }[] = [
  { tab: 'overview', label: 'Overview', path: '' },
  { tab: 'sites', label: 'Sites', path: '/sites' },
  { tab: 'setup', label: 'Task types & milestones', path: '/setup' },
];

/**
 * A project's tasks are its work orders, and live on the workspace dashboard
 * rather than under a project tab; this is that dashboard filtered to one
 * project.
 */
export const projectWorkOrders = (projectId: string) => `/work-orders?projectId=${projectId}`;

/**
 * Every page a project's sites, tasks, task types or milestones are rendered
 * on. The overview summarises all of them, so a change to any one must refresh
 * it as well as its own tab — see `settle` for why each path is named.
 */
export const projectPages = (projectId: string) => PROJECT_TABS.map(({ path }) => `/projects/${projectId}${path}`);
