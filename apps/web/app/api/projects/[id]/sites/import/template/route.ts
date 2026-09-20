import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, apiBaseUrl } from '../../../../../../lib/session';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Streams the site-import template out of the project service.
 *
 * A plain `<a href="/api/v1/...">` cannot work here. That path is the
 * gateway's, not this app's, and the app does not proxy it — `proxy.ts` is
 * session refresh, not an API proxy. Pointing the link straight at the gateway
 * would not help either: the session lives in an http-only cookie scoped to
 * this origin, so a cross-origin navigation would arrive unauthenticated.
 *
 * So the download is a route handler on this origin: it reads the cookie
 * server-side, calls the gateway with a bearer header the way every other call
 * does, and pipes the bytes back. The browser sees an ordinary same-origin
 * download and the token never reaches client script.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Sign in to download the template.' }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/api/v1/projects/${id}/sites/import/template`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'The iPMS API could not be reached.' }, { status: 503 });
  }

  if (!upstream.ok) {
    // The service's own status is preserved — a 403 from a user without
    // site.import must not be reported as a broken download.
    return NextResponse.json(
      { message: upstream.status === 403 ? 'You do not have permission to import sites.' : 'The template could not be generated.' },
      { status: upstream.status },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? XLSX,
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="sites.xlsx"',
      'cache-control': 'no-store',
    },
  }) as NextResponse;
}
