import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, clearSession, revokeSession } from '../../../lib/session';

/**
 * Ends the session in both places it exists: iam's token-version store, and
 * this browser's cookies.
 *
 * The order matters. Revocation is attempted first and its outcome ignored,
 * then the cookies are cleared unconditionally — a user whose gateway is
 * unreachable must still be able to sign out of the machine in front of them.
 *
 * POST only, and reachable from a plain form, so signing out works without
 * client-side JavaScript. It answers with a redirect rather than JSON for the
 * same reason: a form post lands on the login page instead of a page of JSON.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token) await revokeSession(token);

  // `request.url` is the address the container listens on (0.0.0.0:3100), not
  // the one the browser used, so the public origin comes from the proxy's headers.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  const origin = host ? `${proto}://${host}` : request.url;

  // 303 so the browser follows with GET, whatever method arrived here.
  const response = NextResponse.redirect(new URL('/login', origin), 303);
  clearSession(response);
  return response;
}
