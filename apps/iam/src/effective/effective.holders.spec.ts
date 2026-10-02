import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@ipms/contracts';
import { EffectiveService } from './effective.service.js';

const PROJECT = uuidv7();
const OTHER_PROJECT = uuidv7();
const SITE = uuidv7();
const OTHER_SITE = uuidv7();
const PERMISSION = 'qc_review.approve';
const PAST = new Date('2026-01-01T00:00:00Z');

interface UserOptions {
  id?: string;
  isActive?: boolean;
  permissions?: string[];
  roleActive?: boolean;
  validUntil?: Date | null;
  projectIds?: string[];
  siteIds?: string[];
  global?: boolean;
  overrides?: unknown[];
}

function user(opts: UserOptions = {}) {
  return {
    id: opts.id ?? uuidv7(),
    isActive: opts.isActive ?? true,
    tokenVersion: 0,
    roles: [{
      role: {
        code: 'QC_MANAGER',
        isActive: opts.roleActive ?? true,
        permissions: (opts.permissions ?? [PERMISSION]).map((code) => ({ permission: { code } })),
      },
      validFrom: null,
      validUntil: opts.validUntil ?? null,
    }],
    globalScopes: opts.global ? [{ id: 'g' }] : [],
    projectScopes: (opts.projectIds ?? [PROJECT]).map((projectId) => ({ projectId })),
    siteScopes: (opts.siteIds ?? []).map((siteId) => ({ siteId })),
    overrides: opts.overrides ?? [],
  };
}

function build(users: unknown[]) {
  const prisma = { user: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue(users) } };
  return { service: new EffectiveService(prisma as never), prisma };
}

describe('EffectiveService.holders', () => {
  it('asks only for active users', async () => {
    const { service, prisma } = build([]);
    await service.holders(PERMISSION, PROJECT);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });

  it('includes a project-scoped user holding the permission for that project', async () => {
    const holder = user();
    const { service } = build([holder]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([holder.id]);
  });

  it('excludes a user whose scope is a different project', async () => {
    const { service } = build([user({ projectIds: [OTHER_PROJECT] })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('includes a user with global scope', async () => {
    const holder = user({ global: true, projectIds: [] });
    const { service } = build([holder]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([holder.id]);
  });

  it('excludes a user without the permission', async () => {
    const { service } = build([user({ permissions: ['task.view'] })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('excludes an expired role assignment and an inactive role', async () => {
    const { service } = build([user({ validUntil: PAST }), user({ roleActive: false })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('excludes a user with a live DENY override', async () => {
    const denied = user({
      overrides: [{
        permission: { code: PERMISSION }, effect: 'DENY', projectId: null, siteId: null,
        validFrom: null, validUntil: null, reason: 'suspended',
      }],
    });
    const { service } = build([denied]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('excludes a deactivated user even if one reaches this method', async () => {
    const { service } = build([user({ isActive: false })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  describe('site-scoped reviewers', () => {
    it('includes a site-only user for the matching site', async () => {
      const holder = user({ projectIds: [], siteIds: [SITE] });
      const { service } = build([holder]);
      expect(await service.holders(PERMISSION, PROJECT, SITE)).toEqual([holder.id]);
    });

    it('excludes a site-only user for a different site', async () => {
      const { service } = build([user({ projectIds: [], siteIds: [SITE] })]);
      expect(await service.holders(PERMISSION, PROJECT, OTHER_SITE)).toEqual([]);
    });

    it('excludes a site-only user when no site id is supplied', async () => {
      const { service } = build([user({ projectIds: [], siteIds: [SITE] })]);
      expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
    });

    it('still includes a project-only user when a site id is supplied', async () => {
      const holder = user();
      const { service } = build([holder]);
      expect(await service.holders(PERMISSION, PROJECT, SITE)).toEqual([holder.id]);
    });

    it('includes a user scoped to a different project but to this site', async () => {
      const holder = user({ projectIds: [OTHER_PROJECT], siteIds: [SITE] });
      const { service } = build([holder]);
      expect(await service.holders(PERMISSION, PROJECT, SITE)).toEqual([holder.id]);
    });

    it('excludes a site-scoped user with a live DENY override', async () => {
      const denied = user({
        projectIds: [], siteIds: [SITE],
        overrides: [{
          permission: { code: PERMISSION }, effect: 'DENY', projectId: null, siteId: null,
          validFrom: null, validUntil: null, reason: 'suspended',
        }],
      });
      const { service } = build([denied]);
      expect(await service.holders(PERMISSION, PROJECT, SITE)).toEqual([]);
    });
  });
});
