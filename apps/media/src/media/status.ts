import type { MediaStatus } from '@ipms/contracts';

/** Not yet part of any submission: a retake or a cancelled work order may remove these. */
export const PRE_ATTACH: readonly MediaStatus[] = ['PENDING', 'VERIFYING', 'READY', 'REJECTED'];
/** Verified and still in storage. */
export const VIEWABLE: readonly MediaStatus[] = ['READY', 'ATTACHED', 'PURGE_SCHEDULED'];
/** Evidence of record: only the admin purge (sub-project 5) may remove it. */
export const LOCKED: readonly MediaStatus[] = ['ATTACHED', 'PURGE_SCHEDULED', 'PURGED'];
