import type { NextResponse } from 'next/server';
import { proxyDownload } from '../../../../../../../lib/download';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
): Promise<NextResponse> {
  const { id, version } = await params;
  return proxyDownload(
    `/api/v1/qc/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/export`,
    'checklist.xlsx',
    'You do not have permission to view checklist templates.',
  );
}
