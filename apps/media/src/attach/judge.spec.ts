import { describe, expect, it } from 'vitest';
import type { MediaObject } from '@prisma-clients/media';
import { judge, judgeFinance } from './judge.js';

const target = { workOrderId: 'wo-1', siteId: 'site-1' };
const row = (patch: Partial<MediaObject>) => ({ id: 'm1', kind: 'PHOTO', category: 'EVIDENCE', status: 'READY', siteId: 'site-1', workOrderId: 'wo-1', ...patch }) as MediaObject;

describe('judge', () => {
  it.each([
    ['READY', true, undefined],
    ['ATTACHED', true, undefined],
    ['PENDING', false, 'UPLOADING'],
    ['VERIFYING', false, 'VERIFYING'],
    ['REJECTED', false, 'REJECTED'],
    ['DISCARDED', false, 'NOT_FOUND'],
    ['PURGE_SCHEDULED', false, 'NOT_FOUND'],
    ['PURGED', false, 'NOT_FOUND'],
  ])('%s → usable %s, reason %s', (status, usable, reason) => {
    const result = judge('m1', row({ status }), target);
    expect(result).toEqual({ id: 'm1', kind: 'PHOTO', usable, ...(reason ? { reason } : {}) });
  });

  it('treats a missing row or non-evidence as NOT_FOUND with no kind', () => {
    expect(judge('m1', undefined, target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'NOT_FOUND' });
    expect(judge('m1', row({ category: 'GALLERY' }), target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'NOT_FOUND' });
  });

  it('refuses another work order or site as WRONG_WORK_ORDER with no kind', () => {
    expect(judge('m1', row({ workOrderId: 'wo-2' }), target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'WRONG_WORK_ORDER' });
    expect(judge('m1', row({ siteId: 'site-2' }), target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'WRONG_WORK_ORDER' });
  });
});

describe('judgeFinance', () => {
  const finance = (patch: Partial<MediaObject>) => ({ id: 'm1', kind: 'PHOTO', category: 'FINANCE_DOCUMENT', status: 'READY', projectId: 'p-1', ...patch }) as MediaObject;
  const project = { projectId: 'p-1' };

  it.each([
    ['READY', true, undefined],
    ['ATTACHED', true, undefined],
    ['PENDING', false, 'UPLOADING'],
    ['VERIFYING', false, 'VERIFYING'],
    ['REJECTED', false, 'REJECTED'],
    ['DISCARDED', false, 'NOT_FOUND'],
  ])('%s → usable %s, reason %s', (status, usable, reason) => {
    expect(judgeFinance('m1', finance({ status }), project)).toEqual({ id: 'm1', kind: 'PHOTO', usable, ...(reason ? { reason } : {}) });
  });

  it('never accepts site evidence, or a file filed under another project', () => {
    expect(judgeFinance('m1', finance({ category: 'EVIDENCE' }), project)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'NOT_FOUND' });
    expect(judgeFinance('m1', finance({ projectId: 'p-2' }), project)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'NOT_FOUND' });
    expect(judgeFinance('m1', undefined, project)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'NOT_FOUND' });
  });
});
