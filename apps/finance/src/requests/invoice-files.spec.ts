import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../common.js';
import { RequestService } from './request.service.js';

const ACTOR = { id: 'u-1', permissions: ['finance_request.create'] } as unknown as Actor;
const M1 = '0192f7a0-0000-7000-8000-000000000001';
const M2 = '0192f7a0-0000-7000-8000-000000000002';

/** Past the invoice-file step the submit moves into its transaction, which is reached when it throws this. */
class ReachedTransaction extends Error {}

function build(opts: { invoices?: Array<{ mediaId: string | null }>; requester?: string; check?: Array<{ id: string; usable: boolean; reason?: string }>; attach?: 'attached' | 'refused' } = {}) {
  const prisma = {
    financeRequest: {
      findUnique: vi.fn(async () => ({ id: 'r-1', projectId: 'p-1', requesterId: opts.requester ?? 'u-1', invoices: opts.invoices ?? [{ mediaId: M1 }, { mediaId: M2 }, { mediaId: null }, { mediaId: M1 }] })),
    },
    $transaction: vi.fn(async () => { throw new ReachedTransaction(); }),
  };
  const media = {
    check: vi.fn(async () => opts.check ?? [{ id: M1, usable: true }, { id: M2, usable: true }]),
    attach: vi.fn(async () => opts.attach ?? ('attached' as const)),
  };
  return { svc: new RequestService(prisma as never, media as never), prisma, media };
}

describe('submitting a request with invoice photos', () => {
  it('checks then attaches each distinct file under the request and its project, before the status moves', async () => {
    const { svc, media, prisma } = build();
    await expect(svc.submit('r-1', ACTOR, 'Bearer t')).rejects.toBeInstanceOf(ReachedTransaction);
    const body = { requestId: 'r-1', projectId: 'p-1', mediaIds: [M1, M2] };
    expect(media.check).toHaveBeenCalledWith(body, 'Bearer t');
    expect(media.attach).toHaveBeenCalledWith(body, 'Bearer t');
    expect(media.check.mock.invocationCallOrder[0]).toBeLessThan(media.attach.mock.invocationCallOrder[0]!);
    expect(media.attach.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]!);
  });

  it('does not touch media when no invoice has a file', async () => {
    const { svc, media } = build({ invoices: [{ mediaId: null }] });
    await expect(svc.submit('r-1', ACTOR, 'b')).rejects.toBeInstanceOf(ReachedTransaction);
    expect(media.check).not.toHaveBeenCalled();
  });

  it('says to wait while a photo is still uploading, and attaches nothing', async () => {
    const { svc, media, prisma } = build({ check: [{ id: M1, usable: false, reason: 'UPLOADING' }, { id: M2, usable: true }] });
    await expect(svc.submit('r-1', ACTOR, 'b')).rejects.toMatchObject({ status: 422, response: { message: expect.stringContaining('still uploading') } });
    expect(media.attach).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a photo that is missing or was refused', async () => {
    const { svc } = build({ check: [{ id: M1, usable: false, reason: 'REJECTED' }, { id: M2, usable: true }] });
    await expect(svc.submit('r-1', ACTOR, 'b')).rejects.toMatchObject({ status: 422, response: { message: expect.stringContaining('missing or was refused') } });
  });

  it('stops when attaching loses a race', async () => {
    const { svc, prisma } = build({ attach: 'refused' });
    await expect(svc.submit('r-1', ACTOR, 'b')).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads as not found for someone else\'s request', async () => {
    const { svc, media } = build({ requester: 'u-2' });
    await expect(svc.submit('r-1', ACTOR, 'b')).rejects.toMatchObject({ status: 404 });
    expect(media.check).not.toHaveBeenCalled();
  });
});
