import { describe, expect, it, vi } from 'vitest';
import { ViewService } from './view.service.js';

const OWNER = 'owner-1';
const row = (patch: Record<string, unknown> = {}) => ({
  id: 'm1', category: 'FINANCE_DOCUMENT', status: 'READY', uploadedBy: OWNER, projectId: 'p-1', siteId: null,
  storageKey: 'k.jpg', thumbnailKey: 't.webp', ...patch,
});

function service(found: Record<string, unknown> | null) {
  const presignGet = vi.fn(async (key: string) => ({ signedUrl: `https://get/${key}`, expiresAt: 'x' }));
  const svc = new ViewService({ mediaObject: { findUnique: vi.fn(async () => found) } } as never, { presignGet } as never);
  return { svc, presignGet };
}

const inProject = { global: false, projectIds: ['p-1'], siteIds: [] };
const nothing = { global: false, projectIds: [], siteIds: [] };

describe('financeUrl', () => {
  it('lets the uploader see their own invoice file', async () => {
    const { svc } = service(row());
    const out = await svc.financeUrl('m1', 'original', { id: OWNER, permissions: ['finance_request.view'] }, nothing);
    expect(out.signedUrl).toBe('https://get/k.jpg');
  });

  it('lets a viewer of everything in the project see it, and gives the thumbnail on request', async () => {
    const { svc } = service(row());
    const out = await svc.financeUrl('m1', 'thumbnail', { id: 'pm', permissions: ['finance_request.view_all'] }, inProject);
    expect(out.signedUrl).toBe('https://get/t.webp');
  });

  it.each([
    ['someone with only their own access', { id: 'other', permissions: ['finance_request.view'] }, inProject],
    ['a viewer of all outside the project', { id: 'pm', permissions: ['finance_request.view_all'] }, nothing],
  ])('reads as not found for %s', async (_who, user, scope) => {
    const { svc } = service(row());
    await expect(svc.financeUrl('m1', 'original', user, scope)).rejects.toMatchObject({ status: 404 });
  });

  it('never serves site evidence through this route, nor a missing file', async () => {
    await expect(service(row({ category: 'EVIDENCE' })).svc.financeUrl('m1', 'original', { id: OWNER, permissions: [] }, nothing)).rejects.toMatchObject({ status: 404 });
    await expect(service(null).svc.financeUrl('m1', 'original', { id: OWNER, permissions: [] }, nothing)).rejects.toMatchObject({ status: 404 });
  });

  it('will not serve a file that has not been verified', async () => {
    await expect(service(row({ status: 'PENDING' })).svc.financeUrl('m1', 'original', { id: OWNER, permissions: [] }, nothing)).rejects.toMatchObject({ status: 409 });
  });
});
