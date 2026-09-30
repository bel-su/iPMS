import type { MediaView } from '@ipms/contracts';
import type { ItemMedia } from '../../../lib/qc-api';

export interface EvidenceFile {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  capturedAt: string | null;
  distanceText: string;
  /** Not in the previous attempt: the engineer added or replaced it in this one. */
  isNew: boolean;
  thumbSrc: string;
  originalSrc: string;
  downloadSrc: string;
}

export function distanceText(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return 'No location';
  return metres >= 1000 ? `${(Math.round(metres / 100) / 10).toFixed(1)} km from site` : `${metres} m from site`;
}

/**
 * One item's files, in the order the engineer attached them. `facts` comes
 * from media (capture time, distance); a file media no longer lists still
 * appears, without them. `previous` is the prior attempt's file ids for this
 * item, or null on a first attempt.
 */
export function buildEvidence(response: { media: ItemMedia[] }, facts: Map<string, Pick<MediaView, 'capturedAt' | 'distanceFromSiteM'>>, previous: Set<string> | null): EvidenceFile[] {
  return [...response.media].sort((a, b) => a.sequence - b.sequence).map((file) => {
    const fact = facts.get(file.mediaId);
    const src = (variant: 'original' | 'thumbnail') => `/api/media/${file.mediaId}/${variant}`;
    return {
      id: file.mediaId, kind: file.kind, capturedAt: fact?.capturedAt ?? null, distanceText: distanceText(fact?.distanceFromSiteM),
      isNew: previous !== null && !previous.has(file.mediaId),
      thumbSrc: src('thumbnail'), originalSrc: src('original'), downloadSrc: src('original'),
    };
  });
}
