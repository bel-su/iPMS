import type { NextResponse } from 'next/server';
import { markRead } from '../../../../lib/notification-api';
import { respond } from '../../respond';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return respond(await markRead(id));
}
