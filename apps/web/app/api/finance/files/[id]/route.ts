import { NextResponse } from 'next/server';
import { financeFileUrl } from '../../../../lib/media-api';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (message: string, status: number) => NextResponse.json({ message }, { status, headers: NO_STORE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An invoice photo on this origin, for a link or an `<img>`. As for evidence
 * (`/api/media/…`), the session cookie is http-only, so each request signs a
 * fresh short-lived link and redirects to it; none is ever put into a page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) return fail('Not found', 404);
  const variant = new URL(request.url).searchParams.get('variant') === 'thumbnail' ? 'thumbnail' : 'original';
  const result = await financeFileUrl(id, variant);
  switch (result.state) {
    case 'ready': {
      const response = NextResponse.redirect(result.data.signedUrl, 302);
      response.headers.set('cache-control', 'no-store');
      return response;
    }
    case 'unauthenticated': return fail('Sign in to view this file.', 401);
    case 'forbidden': return fail(result.message, 403);
    case 'unavailable': return fail(result.message, result.status && result.status < 500 ? result.status : 503);
  }
}
