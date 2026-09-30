import 'server-only';
import type { MediaView, SignedGet } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

export type MediaVariant = 'original' | 'thumbnail';

/** Every file on a work order the caller's scope reaches, with capture facts. Thumbnail links inside expire; the page uses `/api/media/…` instead. */
export function listWorkOrderMedia(workOrderId: string): Promise<ApiResult<MediaView[]>> {
  return authFetch<MediaView[]>('/api/v1/media', { query: { workOrderId } });
}

/** A 5-minute link to one file. Never rendered into a page: see `app/api/media/[id]/[variant]/route.ts`. */
export function mediaUrl(id: string, variant: MediaVariant): Promise<ApiResult<SignedGet>> {
  return authFetch<SignedGet>(`/api/v1/media/${encodeURIComponent(id)}/url`, { query: { variant } });
}
