import type { MediaObject } from '@prisma-clients/media';
import type { MediaCheckReason, MediaCheckResult, MediaKind } from '@ipms/contracts';

const WAITING: Partial<Record<string, MediaCheckReason>> = { PENDING: 'UPLOADING', VERIFYING: 'VERIFYING', REJECTED: 'REJECTED' };

/**
 * Whether one file can be evidence for a submission of `target`'s work order.
 * The one rule behind both the read-only check and attach.
 *
 * A file already ATTACHED is usable again for the same work order: rework
 * attempts carry forward the files the reviewer did not object to. A file
 * never moves to another work order, even on the same site.
 */
export function judge(id: string, row: MediaObject | undefined, target: { workOrderId: string; siteId: string }): MediaCheckResult {
  if (!row || row.category !== 'EVIDENCE') return { id, kind: null, usable: false, reason: 'NOT_FOUND' };
  if (row.siteId !== target.siteId || row.workOrderId !== target.workOrderId) return { id, kind: null, usable: false, reason: 'WRONG_WORK_ORDER' };
  const kind = row.kind as MediaKind;
  if (row.status === 'READY' || row.status === 'ATTACHED') return { id, kind, usable: true };
  return { id, kind, usable: false, reason: WAITING[row.status] ?? 'NOT_FOUND' };
}
