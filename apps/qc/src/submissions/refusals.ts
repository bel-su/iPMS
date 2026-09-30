import { ConflictException } from '@nestjs/common';
import { REFUSAL_REASONS } from '@ipms/contracts';

/** 409s with `details.reason`, which the shared exception filter passes to the client. */
const conflict = (reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ message, details: { reason, ...extra } });

export const mediaNotReady = (files: { id: string; reason?: string | undefined }[]) =>
  conflict(REFUSAL_REASONS.MEDIA_NOT_READY, files.length
    ? 'Some evidence files are not ready to submit'
    : 'Evidence files changed while submitting; try again', { files: files.map((f) => ({ id: f.id, reason: f.reason })) });

export const draftHeldElsewhere = (holder: { deviceLabel: string; updatedAt: Date }) =>
  conflict(REFUSAL_REASONS.DRAFT_HELD_ELSEWHERE, `This work order is open on another device (${holder.deviceLabel})`, {
    deviceLabel: holder.deviceLabel, updatedAt: holder.updatedAt.toISOString(),
  });

export const draftStale = (version: number) =>
  conflict(REFUSAL_REASONS.DRAFT_STALE, 'This draft has changed since it was loaded', { version });

export const workOrderClosed = () =>
  conflict(REFUSAL_REASONS.WORK_ORDER_CLOSED, 'This work order is not open for changes');
