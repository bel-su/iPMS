import 'server-only';
import { cookies } from 'next/headers';

export interface DashboardProject {
  id: string;
  code: string;
  name: string;
  phase: string | null;
  status: string;
  _count: { sites: number };
}

export interface ProjectDashboard {
  activeProjectCount: number;
  sitesInDelivery: number;
  pendingReviews: number;
  rectifyingTasks: number;
  projects: DashboardProject[];
}

export type DashboardResult =
  | { state: 'ready'; data: ProjectDashboard }
  | { state: 'unauthenticated' }
  | { state: 'unavailable' };

const apiBaseUrl = process.env['IPMS_API_BASE_URL'] ?? 'http://127.0.0.1:3000';

/** Calls the gateway, never the Project service directly, preserving one public API boundary. */
export async function getProjectDashboard(): Promise<DashboardResult> {
  const token = (await cookies()).get('ipms_access_token')?.value;
  if (!token) return { state: 'unauthenticated' };

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/dashboard`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) return { state: 'unauthenticated' };
    if (!response.ok) return { state: 'unavailable' };
    return { state: 'ready', data: await response.json() as ProjectDashboard };
  } catch {
    return { state: 'unavailable' };
  }
}
