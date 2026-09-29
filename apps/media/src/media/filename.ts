import type { MediaKind } from '@ipms/contracts';

const pad = (n: number) => n.toString().padStart(2, '0');

function stamp(at: Date | null): string {
  if (!at) return 'undated';
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
}

/** What a download is called on the reviewer's disk; the bucket key itself is all IDs. */
export function readableName(o: { siteCode: string | null; capturedAt: Date | null; id: string; variant: 'original' | 'thumbnail'; kind: MediaKind }): string {
  const ext = o.variant === 'thumbnail' ? (o.kind === 'VIDEO' ? 'jpg' : 'webp') : (o.kind === 'VIDEO' ? 'mp4' : 'jpg');
  return `${o.siteCode ?? 'site'}_${stamp(o.capturedAt)}_${o.id.slice(-6)}.${ext}`;
}
