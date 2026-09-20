import { NextResponse } from 'next/server';
import { loginWithPassword, writeSession } from '../../../lib/session';

/**
 * Exchanges a username and password for a session this browser holds in
 * http-only cookies, so the access token is never readable from client script.
 *
 * The credentials are checked by iam, not here. This handler only refuses a
 * request that is not a login attempt at all, so that a malformed body is
 * reported as a bad request rather than as an unavailable gateway.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Enter a username and password.' }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return NextResponse.json({ message: 'Enter a username and password.' }, { status: 400 });
  }

  const result = await loginWithPassword({ username, password });

  if (result.state === 'rejected') {
    return NextResponse.json({ message: 'Invalid username or password.' }, { status: 401 });
  }
  if (result.state === 'unavailable') {
    return NextResponse.json({ message: 'The iPMS API is not available. Try again in a moment.' }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true });
  writeSession(response, result.tokens);
  return response;
}
