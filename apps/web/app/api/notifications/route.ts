import type { NextResponse } from 'next/server';
import { listNotifications } from '../../lib/notification-api';
import { respond } from './respond';

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  return respond(await listNotifications({
    limit: params.get('limit') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    unreadOnly: params.get('unreadOnly') ?? undefined,
  }));
}
