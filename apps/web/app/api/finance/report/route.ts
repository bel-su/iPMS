import { proxyDownload } from '../../../lib/download';

const GROUPINGS = ['project', 'category', 'requester'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The spend report as an Excel file. A plain link to the gateway would arrive
 * unauthenticated (the session is an http-only cookie on this origin), so the
 * download is a route handler that reads the cookie server-side — the same
 * shape as the site-import template route.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('groupBy');
  const groupBy = GROUPINGS.find((g) => g === requested) ?? 'project';
  const params = new URLSearchParams({ groupBy });
  for (const key of ['projectId', 'from', 'to'] as const) {
    const value = url.searchParams.get(key);
    if (value && (key === 'projectId' || DATE.test(value))) params.set(key, value);
  }
  params.set('format', 'xlsx');
  return proxyDownload(
    `/api/v1/finance/reports/project-spend?${params.toString()}`,
    `finance-spend-by-${groupBy}.xlsx`,
    'You need access to finance reports to download this.',
  );
}
