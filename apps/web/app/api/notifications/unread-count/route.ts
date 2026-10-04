import type { NextResponse } from 'next/server';
import { unreadCount } from '../../../lib/notification-api';
import { respond } from '../respond';

export async function GET(): Promise<NextResponse> {
  return respond(await unreadCount());
}
