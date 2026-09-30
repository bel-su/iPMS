import { NextResponse } from 'next/server';
import { mediaUrl, type MediaVariant } from '../../../../lib/media-api';

/** `download` is virtual: the original, signed as an attachment. */
const VARIANTS = ['original', 'thumbnail', 'download'] as const;
const NO_STORE = { 'cache-control': 'no-store' };
const fail = (message: string, status: number) => NextResponse.json({ message }, { status, headers: NO_STORE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evidence files on this origin, for `<img>`, `<video>` and downloads.
 *
 * The session cookie is http-only here, so the browser cannot ask media
 * itself. Each request signs a fresh 5-minute link and redirects to it: a page
 * left open never holds a link that has expired, and no signed URL is ever
 * rendered into HTML.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
): Promise<NextResponse> {
  const { id, variant } = await params;
  if (!UUID.test(id) || !(VARIANTS as readonly string[]).includes(variant)) return fail('Not found', 404);
  const result = variant === 'download' ? await mediaUrl(id, 'original', true) : await mediaUrl(id, variant as MediaVariant);
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
