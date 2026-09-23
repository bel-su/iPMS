import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, apiBaseUrl } from './session';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Streams a file from the gateway to the browser on this origin. The session
 * is an http-only cookie scoped here, so a link straight at the gateway would
 * arrive unauthenticated; this reads the cookie server-side and pipes the bytes.
 */
export async function proxyDownload(path: string, fallbackFilename: string, forbiddenMessage: string): Promise<NextResponse> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Sign in to download this file.' }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    return NextResponse.json({ message: 'The iPMS API could not be reached.' }, { status: 503 });
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { message: upstream.status === 403 ? forbiddenMessage : 'The file could not be generated.' },
      { status: upstream.status },
    );
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? XLSX,
      'content-disposition': upstream.headers.get('content-disposition') ?? `attachment; filename="${fallbackFilename}"`,
      'cache-control': 'no-store',
    },
  }) as NextResponse;
}
