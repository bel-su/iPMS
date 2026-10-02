import { NextResponse } from 'next/server';
import type { ApiResult } from '../../lib/api-client';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (message: string, status: number) => NextResponse.json({ message }, { status, headers: NO_STORE });

/** Turns what `authFetch` found into the response the browser sees, never leaking an upstream body. */
export function respond<T>(result: ApiResult<T>): NextResponse {
  switch (result.state) {
    case 'ready':
      return result.data === undefined
        ? new NextResponse(null, { status: 204, headers: NO_STORE })
        : NextResponse.json(result.data, { headers: NO_STORE });
    case 'unauthenticated': return fail('Sign in to continue.', 401);
    case 'forbidden': return fail(result.message, 403);
    case 'unavailable': return fail(result.message, result.status !== null && result.status < 500 ? result.status : 503);
  }
}
