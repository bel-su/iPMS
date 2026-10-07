import { describe, expect, it, vi } from 'vitest';
import { UploadService } from './upload.service.js';

const P = '0192f7a0-0000-7000-8000-000000000001';
const M = '0192f7a0-0000-7000-8000-000000000003';
const USER = '0192f7a0-0000-7000-8000-000000000009';
const HASH = 'a'.repeat(64);

const dto = { id: M, projectId: P, kind: 'PHOTO' as const, contentType: 'image/jpeg', sizeBytes: 1000, contentHash: HASH, deviceId: 'dev-1' };

function service(opts: { scope?: { global: boolean; projectIds: string[]; siteIds: string[] }; existing?: Record<string, unknown> | null } = {}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, status: 'PENDING', multipartUploadId: null }));
  const prisma = {
    mediaObject: { findUnique: vi.fn(async () => opts.existing ?? null), count: vi.fn(async () => 0), create },
  };
  const storage = { presignPut: vi.fn(async () => ({ signedUrl: 'https://put', headers: { 'content-type': 'image/jpeg' }, expiresAt: 'x' })) };
  const project = {
    geofence: vi.fn(),
    scope: vi.fn(async () => ({ state: 'found' as const, value: opts.scope ?? { global: false, projectIds: [P], siteIds: [] } })),
  };
  const svc = new UploadService(prisma as never, storage as never, { workOrder: vi.fn() } as never, project as never, {} as never);
  return { svc, create, project, storage };
}

describe('registerFinanceDocument', () => {
  it('files an invoice photo under its project, with no site or work order', async () => {
    const { svc, create } = service();
    const out = await svc.registerFinanceDocument(dto, USER, 'Bearer t');
    expect(out.status).toBe('PENDING');
    expect(out.upload).toMatchObject({ mode: 'single', signedUrl: 'https://put' });
    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      id: M, kind: 'PHOTO', category: 'FINANCE_DOCUMENT', projectId: P, uploadedBy: USER,
      storageKey: `projects/${P}/finance/${M}.jpg`,
    });
    expect(data).not.toHaveProperty('siteId');
    expect(data).not.toHaveProperty('workOrderId');
  });

  it('refuses a project outside the caller\'s scope', async () => {
    const { svc, create } = service({ scope: { global: false, projectIds: [], siteIds: [] } });
    await expect(svc.registerFinanceDocument(dto, USER, 'b')).rejects.toMatchObject({ status: 403 });
    expect(create).not.toHaveBeenCalled();
  });

  it('lets a global caller file into any project', async () => {
    const { svc, create } = service({ scope: { global: true, projectIds: [], siteIds: [] } });
    await svc.registerFinanceDocument(dto, USER, 'b');
    expect(create).toHaveBeenCalledOnce();
  });

  it('accepts only a JPEG within the photo size limit', async () => {
    const { svc } = service();
    await expect(svc.registerFinanceDocument({ ...dto, contentType: 'image/png' }, USER, 'b')).rejects.toMatchObject({ status: 400 });
    await expect(svc.registerFinanceDocument({ ...dto, sizeBytes: 6 * 1024 * 1024 }, USER, 'b')).rejects.toMatchObject({ status: 413 });
  });

  it('answers a retry with the same object, and refuses someone else\'s id', async () => {
    const existing = { id: M, category: 'FINANCE_DOCUMENT', status: 'PENDING', uploadedBy: USER, contentHash: HASH, storageKey: 'k', contentType: 'image/jpeg', sizeBytes: 1000, kind: 'PHOTO', thumbnailKey: 't', multipartUploadId: null };
    const retry = service({ existing });
    expect((await retry.svc.registerFinanceDocument(dto, USER, 'b')).upload).toMatchObject({ mode: 'single' });
    expect(retry.project.scope).not.toHaveBeenCalled();

    await expect(service({ existing }).svc.registerFinanceDocument(dto, 'someone-else', 'b')).rejects.toMatchObject({ status: 409 });
    await expect(service({ existing: { ...existing, category: 'EVIDENCE' } }).svc.registerFinanceDocument(dto, USER, 'b')).rejects.toMatchObject({ status: 409 });
  });
});
