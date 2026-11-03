import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, clearSession, revokeSession } from '../../../lib/session';

function isAllowedHost(candidate: string, defaultHost: string): boolean {
  if (candidate === defaultHost) return true;
  const base = candidate.split(':')[0]!.toLowerCase();
  const defBase = defaultHost.split(':')[0]!.toLowerCase();
  if (base === defBase) return true;
  if (base === 'localhost' || base === '127.0.0.1' || base === 'ipms.local' || base.endsWith('.ipms.local')) return true;
  if (process.env['NEXT_PUBLIC_APP_URL']) {
    try {
      if (new URL(process.env['NEXT_PUBLIC_APP_URL']).host === candidate) return true;
    } catch {}
  }
  return false;
}

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

  // Validate forwarded host against trusted domains to prevent open redirects
  const reqHost = new URL(request.url).host;
  const rawHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const host = rawHost && isAllowedHost(rawHost, reqHost) ? rawHost : reqHost;
  const proto = request.headers.get('x-forwarded-proto') ?? (request.url.startsWith('https:') ? 'https' : 'http');
  const origin = `${proto}://${host}`;

  // 303 so the browser follows with GET, whatever method arrived here.
  const response = NextResponse.redirect(new URL('/login', origin), 303);
  clearSession(response);
  return response;
}
