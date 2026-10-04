import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { InternalAuthzController } from './internal-authz.controller.js';
import { InternalKeyGuard } from './internal-key.guard.js';

const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };

describe('InternalAuthzController', () => {
  it('returns the holders the service finds', async () => {
    const projectId = uuidv7();
    const effective = { holders: vi.fn().mockResolvedValue(['u-1', 'u-2']) };
    const controller = new InternalAuthzController(effective as never);
    expect(await controller.holders({ permission: 'qc_review.approve', projectId })).toEqual({ userIds: ['u-1', 'u-2'] });
    expect(effective.holders).toHaveBeenCalledWith('qc_review.approve', projectId, undefined);
  });

  it('passes a site id through to the service', async () => {
    const projectId = uuidv7();
    const siteId = uuidv7();
    const effective = { holders: vi.fn().mockResolvedValue(['u-1']) };
    const controller = new InternalAuthzController(effective as never);
    await controller.holders({ permission: 'qc_review.approve', projectId, siteId });
    expect(effective.holders).toHaveBeenCalledWith('qc_review.approve', projectId, siteId);
  });

  it('refuses a malformed body', async () => {
    const controller = new InternalAuthzController({ holders: vi.fn() } as never);
    await expect(controller.holders({ permission: '', projectId: 'x' })).rejects.toThrow();
  });

  // Public bypasses the user-token guard; the key guard must be what stands in front of every route here.
  it('is public to the token guard but locked by the internal key guard', () => {
    expect(reflectMetadata.getMetadata(IS_PUBLIC_KEY, InternalAuthzController)).toBe(true);
    expect(reflectMetadata.getMetadata(GUARDS_METADATA, InternalAuthzController)).toContain(InternalKeyGuard);
  });
});
