import { proxyDownload } from '../../../lib/download';
import { resolveReportQuery } from '../../../finance/report-model';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The spend report as an Excel file. A plain link to the gateway would arrive
 * unauthenticated (the session is an http-only cookie on this origin), so the
 * download is a route handler that reads the cookie server-side — the same
 * shape as the site-import template route.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { groupBy, from, to } = resolveReportQuery({ groupBy: searchParams.get('groupBy') ?? undefined, from: searchParams.get('from') ?? undefined, to: searchParams.get('to') ?? undefined });
  const projectId = searchParams.get('projectId');
  const params = new URLSearchParams({ groupBy });
  if (projectId && UUID.test(projectId)) params.set('projectId', projectId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('format', 'xlsx');
  return proxyDownload(
    `/api/v1/finance/reports/project-spend?${params.toString()}`,
    `finance-spend-by-${groupBy}.xlsx`,
    'You need access to finance reports to download this.',
  );
}
