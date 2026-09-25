import type { NextResponse } from 'next/server';
import { proxyDownload } from '../../../../lib/download';

export async function GET(): Promise<NextResponse> {
  return proxyDownload('/api/v1/qc/templates/import/blank', 'checklist-template.xlsx', 'You do not have permission to view checklist templates.');
}
