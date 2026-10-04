import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { MAX_PACKAGE_BYTES, dispositionFilename, entryName, packageFilename } from '../../../../lib/photo-package';
import { mediaUrl } from '../../../../lib/media-api';
import { getSubmission } from '../../../../lib/qc-api';
import { getWorkOrder } from '../../../../lib/work-order-api';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (message: string, status: number) => NextResponse.json({ message }, { status, headers: NO_STORE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARALLEL = 4;

/**
 * Every photo of a finished work order as one zip, so a reviewer does not
 * have to save them one at a time.
 *
 * Built on this origin for the same reason `/api/media/…` is: the session
 * cookie is http-only here. The work order and its submission are read with
 * the caller's own token, so they get exactly the photos their scope allows;
 * each file is then fetched through a freshly signed link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) return fail('Not found', 404);

  const order = await getWorkOrder(id);
  if (order.state === 'unauthenticated') return fail('Sign in to download these photos.', 401);
  if (order.state === 'forbidden') return fail(order.message, 403);
  if (order.state !== 'ready') return fail(order.message, order.status && order.status < 500 ? order.status : 503);
  const wo = order.data;
  if (!wo.currentSubmissionId) return fail('This work order has no submission yet.', 409);

  const submitted = await getSubmission(wo.currentSubmissionId);
  if (submitted.state === 'unauthenticated') return fail('Sign in to download these photos.', 401);
  if (submitted.state === 'forbidden') return fail(submitted.message, 403);
  if (submitted.state !== 'ready') return fail(submitted.message, submitted.status && submitted.status < 500 ? submitted.status : 503);
  const submission = submitted.data;
  // Only finished work: a package of a half-reviewed or reworked attempt would mislead.
  if (wo.status !== 'COMPLETED' && submission.status !== 'APPROVED') return fail('Photos can be downloaded once the work order is completed.', 409);

  const photos = [...submission.responses]
    .sort((a, b) => a.item.order - b.item.order)
    .flatMap((response, position) => response.media
      .filter((m) => m.kind === 'PHOTO')
      .sort((a, b) => a.sequence - b.sequence)
      .map((m, index) => ({ mediaId: m.mediaId, itemNumber: position + 1, indexInItem: index + 1 })));
  if (photos.length === 0) return fail('This work order has no photos.', 404);

  const zip = new JSZip();
  let total = 0;
  for (let start = 0; start < photos.length; start += PARALLEL) {
    const batch = photos.slice(start, start + PARALLEL);
    const results = await Promise.all(batch.map(async (photo) => {
      const link = await mediaUrl(photo.mediaId, 'original', true);
      if (link.state !== 'ready') return { photo, error: link.state === 'unauthenticated' ? 'Sign in to download these photos.' : link.state === 'forbidden' ? link.message : 'A photo could not be prepared.' };
      let file: Response;
      try { file = await fetch(link.data.signedUrl, { cache: 'no-store' }); } catch { return { photo, error: 'A photo could not be fetched.' }; }
      if (!file.ok) return { photo, error: 'A photo could not be fetched.' };
      return { photo, bytes: await file.arrayBuffer(), name: dispositionFilename(file.headers.get('content-disposition')), type: file.headers.get('content-type') };
    }));
    for (const result of results) {
      if ('error' in result) return fail(result.error!, 502);
      total += result.bytes!.byteLength;
      if (total > MAX_PACKAGE_BYTES) return fail('These photos are too large to package. Download them one at a time.', 413);
      // Already-compressed images: storing them is faster and no bigger.
      zip.file(entryName(result.photo.itemNumber, result.photo.indexInItem, result.name ?? null, result.type ?? null), result.bytes!, { binary: true });
    }
  }

  const body = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${packageFilename(wo.project.code, wo.site.siteCode)}"`,
      'content-length': String(body.byteLength),
      ...NO_STORE,
    },
  }) as NextResponse;
}
