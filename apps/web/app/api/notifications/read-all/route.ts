import type { NextResponse } from 'next/server';
import { markAllRead } from '../../../lib/notification-api';
import { respond } from '../respond';

export async function POST(): Promise<NextResponse> {
  return respond(await markAllRead());
}
