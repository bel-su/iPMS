import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScopesService } from './scopes.service.js';
import { uuidv7 } from '@ipms/contracts';

const ACTOR = uuidv7();
const USER = uuidv7();
const PROJECT = uuidv7();
const SITE = uuidv7();
const OVERRIDE = uuidv7();

/** Everything the actor needs to hold for a plain `qc_review.approve` ALLOW grant. */
const ACTOR_PERMISSIONS = ['qc_review.approve'];

interface BuildOptions {
  user?: unknown;
  existingScope?: unknown;
  existingSiteScope?: unknown;
  projectScope?: unknown;
  permission?: unknown;
  existingOverride?: unknown;
  existingGlobalScope?: unknown;
  globalScopeRow?: unknown;
  cascadedSites?: unknown[];
  overrides?: unknown[];
}

function build(opts: BuildOptions = {}) {
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue(opts.user === undefined ? { id: USER, isActive: true } : opts.user),
      update: vi.fn().mockResolvedValue({ id: USER, tokenVersion: 7 }),
    },
    permission: { findUnique: vi.fn().mockResolvedValue(opts.permission === undefined ? { id: uuidv7(), code: 'qc_review.approve' } : opts.permission) },
    userProjectScope: {
      findUnique: vi.fn().mockResolvedValue(
        opts.projectScope === undefined ? (opts.existingScope ?? null) : opts.projectScope,
      ),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userSiteScope: {
      findUnique: vi.fn().mockResolvedValue(opts.existingSiteScope ?? null),
      findMany: vi.fn().mockResolvedValue(opts.cascadedSites ?? []),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userGlobalScope: {
      findUnique: vi.fn().mockResolvedValue(opts.existingGlobalScope ?? null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      deleteMany: vi.fn().mockResolvedValue({ count: opts.existingGlobalScope ? 1 : 0 }),
    },
    userPermissionOverride: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      findUnique: vi.fn().mockResolvedValue(
        opts.existingOverride === undefined ? { id: OVERRIDE, userId: USER } : opts.existingOverride,
      ),
      delete: vi.fn().mockResolvedValue({}),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    userGlobalScope: { findUnique: vi.fn().mockResolvedValue(opts.globalScopeRow ?? null) },
    userProjectScope: { findMany: vi.fn().mockResolvedValue([{ projectId: PROJECT }]) },
    userSiteScope: { findMany: vi.fn().mockResolvedValue([{ siteId: SITE }]) },
    userPermissionOverride: { findMany: vi.fn().mockResolvedValue(opts.overrides ?? []) },
  };
  const versions = { publish: vi.fn().mockResolvedValue(undefined) };
  const tokens = { refreshTtlSeconds: 2_592_000 };
  return {
    service: new ScopesService(prisma as never, versions as never, tokens as never),
    tx, prisma, versions,
  };
}

function subjectsOf(tx: { outboxEvent: { create: { mock: { calls: unknown[][] } } } }): string[] {
  return tx.outboxEvent.create.mock.calls.map((c) => (c[0] as { data: { subject: string } }).data.subject);
}

function payloadsOf(
  tx: { outboxEvent: { create: { mock: { calls: unknown[][] } } } },
  subject: string,
): Record<string, unknown>[] {
  return tx.outboxEvent.create.mock.calls
    .map((c) => (c[0] as { data: { subject: string; payload: Record<string, unknown> } }).data)
    .filter((d) => d.subject === subject)
    .map((d) => d.payload);
}

describe('ScopesService.grantProject', () => {
  it('creates the scope row', async () => {
    const { service, tx } = build();
    await service.grantProject(USER, PROJECT, ACTOR);
    expect(tx.userProjectScope.create).toHaveBeenCalled();
  });

  it('emits iam.scope.granted in the same transaction', async () => {
    const { service, tx } = build();
    await service.grantProject(USER, PROJECT, ACTOR);
    expect(subjectsOf(tx)).toContain('iam.scope.granted');
  });

  it('also emits an audit event', async () => {
    const { service, tx } = build();
    await service.grantProject(USER, PROJECT, ACTOR);
    expect(subjectsOf(tx)).toContain('audit.event.recorded');
  });

  it('is idempotent when the scope already exists', async () => {
    const { service, tx } = build({ existingScope: { id: uuidv7() } });
    await service.grantProject(USER, PROJECT, ACTOR);
    expect(tx.userProjectScope.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a grant to an unknown user', async () => {
    const { service } = build({ user: null });
    await expect(service.grantProject(USER, PROJECT, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ScopesService.revokeProject', () => {
  it('emits iam.scope.revoked so caches drop the project immediately', async () => {
    const { service, tx } = build();
    await service.revokeProject(USER, PROJECT, ACTOR);
    expect(subjectsOf(tx)).toContain('iam.scope.revoked');
  });

  it('emits nothing when there was no scope to revoke', async () => {
    const { service, tx } = build();
    tx.userProjectScope.deleteMany.mockResolvedValue({ count: 0 });
    await service.revokeProject(USER, PROJECT, ACTOR);
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  /**
   * The cascade deletes the user's site rows under the revoked project but used
   * to emit one PROJECT-level event with `siteId: null`. A consumer cache keyed
   * by site had no way to work out which sites to drop, so the orphaned access
   * the cascade exists to prevent moved out of the database and into every
   * cache instead.
   */
  it('emits one SITE-level revoke per cascaded site row', async () => {
    const other = uuidv7();
    const { service, tx } = build({
      cascadedSites: [
        { id: uuidv7(), siteId: SITE, projectId: PROJECT },
        { id: uuidv7(), siteId: other, projectId: PROJECT },
      ],
    });
    await service.revokeProject(USER, PROJECT, ACTOR);

    const revokes = payloadsOf(tx, 'iam.scope.revoked');
    expect(revokes.filter((p) => p['level'] === 'SITE').map((p) => p['siteId']).sort())
      .toEqual([SITE, other].sort());
  });

  it('gives each cascaded SITE event the project it was revoked under', async () => {
    const { service, tx } = build({ cascadedSites: [{ id: uuidv7(), siteId: SITE, projectId: PROJECT }] });
    await service.revokeProject(USER, PROJECT, ACTOR);
    const site = payloadsOf(tx, 'iam.scope.revoked').find((p) => p['level'] === 'SITE');
    expect(site).toMatchObject({ userId: USER, level: 'SITE', projectId: PROJECT, siteId: SITE });
  });

  it('reads the site rows before deleting them, or there is nothing left to name', async () => {
    const { service, tx } = build({ cascadedSites: [{ id: uuidv7(), siteId: SITE, projectId: PROJECT }] });
    await service.revokeProject(USER, PROJECT, ACTOR);
    const readAt = tx.userSiteScope.findMany.mock.invocationCallOrder[0]!;
    const deletedAt = tx.userSiteScope.deleteMany.mock.invocationCallOrder[0]!;
    expect(readAt).toBeLessThan(deletedAt);
  });

  it('still emits the PROJECT-level revoke', async () => {
    const { service, tx } = build({ cascadedSites: [{ id: uuidv7(), siteId: SITE, projectId: PROJECT }] });
    await service.revokeProject(USER, PROJECT, ACTOR);
    expect(payloadsOf(tx, 'iam.scope.revoked').some((p) => p['level'] === 'PROJECT')).toBe(true);
  });
});

describe('ScopesService.grantSite', () => {
  it('creates the site scope row', async () => {
    const { service, tx } = build({ projectScope: { id: uuidv7(), userId: USER, projectId: PROJECT } });
    await service.grantSite(USER, SITE, PROJECT, ACTOR);
    expect(tx.userSiteScope.create).toHaveBeenCalled();
  });

  it('emits iam.scope.granted with both ids in the payload', async () => {
    const { service, tx } = build({ projectScope: { id: uuidv7(), userId: USER, projectId: PROJECT } });
    await service.grantSite(USER, SITE, PROJECT, ACTOR);
    expect(payloadsOf(tx, 'iam.scope.granted')[0])
      .toMatchObject({ userId: USER, level: 'SITE', projectId: PROJECT, siteId: SITE });
  });

  it('audits the grant', async () => {
    const { service, tx } = build({ projectScope: { id: uuidv7() } });
    await service.grantSite(USER, SITE, PROJECT, ACTOR);
    expect(subjectsOf(tx)).toContain('audit.event.recorded');
  });

  it('is idempotent when the site scope already exists', async () => {
    const { service, tx } = build({
      projectScope: { id: uuidv7() }, existingSiteScope: { id: uuidv7() },
    });
    await service.grantSite(USER, SITE, PROJECT, ACTOR);
    expect(tx.userSiteScope.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a grant to an unknown user', async () => {
    const { service } = build({ user: null, projectScope: { id: uuidv7() } });
    await expect(service.grantSite(USER, SITE, PROJECT, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * `projectId` arrives in the request body and used to be trusted. A grant
   * naming a project the user has no scope for was accepted, and
   * `revokeProject`'s cascade filters on `projectId` — so that row could never
   * be reached by the revoke that was supposed to clean it up.
   */
  it('rejects a site grant under a project the user does not hold scope for', async () => {
    const { service } = build({ projectScope: null });
    await expect(service.grantSite(USER, SITE, PROJECT, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes nothing when the project scope is missing', async () => {
    const { service, tx } = build({ projectScope: null });
    await service.grantSite(USER, SITE, PROJECT, ACTOR).catch(() => undefined);
    expect(tx.userSiteScope.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('ScopesService.revokeSite', () => {
  it('emits iam.scope.revoked at SITE level', async () => {
    const { service, tx } = build({ existingSiteScope: { id: uuidv7(), siteId: SITE, projectId: PROJECT } });
    await service.revokeSite(USER, SITE, ACTOR);
    expect(payloadsOf(tx, 'iam.scope.revoked')[0]).toMatchObject({ level: 'SITE', siteId: SITE });
  });

  /**
   * The payload hardcoded `projectId: null` although the column is non-nullable
   * and the value is on the row being deleted, so a consumer could not tell
   * which project's site had gone.
   */
  it('names the real project the site sat under, not null', async () => {
    const { service, tx } = build({ existingSiteScope: { id: uuidv7(), siteId: SITE, projectId: PROJECT } });
    await service.revokeSite(USER, SITE, ACTOR);
    expect(payloadsOf(tx, 'iam.scope.revoked')[0]?.['projectId']).toBe(PROJECT);
  });

  it('reads the row before deleting it', async () => {
    const { service, tx } = build({ existingSiteScope: { id: uuidv7(), siteId: SITE, projectId: PROJECT } });
    await service.revokeSite(USER, SITE, ACTOR);
    expect(tx.userSiteScope.findUnique.mock.invocationCallOrder[0]!)
      .toBeLessThan(tx.userSiteScope.delete.mock.invocationCallOrder[0]!);
  });

  it('audits the revoke', async () => {
    const { service, tx } = build({ existingSiteScope: { id: uuidv7(), siteId: SITE, projectId: PROJECT } });
    await service.revokeSite(USER, SITE, ACTOR);
    expect(subjectsOf(tx)).toContain('audit.event.recorded');
  });

  it('emits nothing when there was no site scope to revoke', async () => {
    const { service, tx } = build({ existingSiteScope: null });
    await service.revokeSite(USER, SITE, ACTOR);
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(tx.userSiteScope.delete).not.toHaveBeenCalled();
  });
});

describe('ScopesService.createOverride', () => {
  const dto = {
    permissionCode: 'qc_review.approve', effect: 'ALLOW' as const,
    validUntil: '2026-09-30T00:00:00.000Z', reason: 'Temporary QC cover',
  };

  it('persists the override with its reason', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, dto, ACTOR, ACTOR_PERMISSIONS);
    expect(tx.userPermissionOverride.create.mock.calls[0]![0].data.reason).toBe('Temporary QC cover');
  });

  it('audits the override', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, dto, ACTOR, ACTOR_PERMISSIONS);
    expect(subjectsOf(tx)).toContain('audit.event.recorded');
  });

  it('rejects an unknown permission code', async () => {
    const { service } = build({ permission: null });
    await expect(service.createOverride(USER, dto, ACTOR, ACTOR_PERMISSIONS))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a validUntil earlier than validFrom', async () => {
    const { service } = build();
    await expect(service.createOverride(USER, {
      ...dto, validFrom: '2026-10-01T00:00:00.000Z', validUntil: '2026-09-01T00:00:00.000Z',
    }, ACTOR, ACTOR_PERMISSIONS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a grant to an unknown user', async () => {
    const { service } = build({ user: null });
    await expect(service.createOverride(USER, dto, ACTOR, ACTOR_PERMISSIONS))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * While overrides were inert, `override.create` being otherwise unrestricted was
 * harmless. Enforcing them turns it into a self-escalation primitive: the
 * dependency closure of `override.create` is only `override.view` +
 * `permission.view`, so its holder could post
 * `{permissionCode: 'role.delete', effect: 'ALLOW'}` against their own id and
 * then grant themselves the entire catalogue. These two rules and the
 * enforcement have to ship together.
 */
describe('ScopesService.createOverride — privilege escalation', () => {
  const allowRoleDelete = {
    permissionCode: 'role.delete', effect: 'ALLOW' as const, reason: 'escalation attempt',
  };

  it('refuses an ALLOW override for a permission the actor does not hold', async () => {
    const { service } = build();
    await expect(service.createOverride(USER, allowRoleDelete, ACTOR, ['override.create', 'override.view']))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes nothing when it refuses the escalation', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, allowRoleDelete, ACTOR, ['override.create']).catch(() => undefined);
    expect(tx.userPermissionOverride.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('refuses an override targeting the actor themselves', async () => {
    const { service } = build();
    await expect(service.createOverride(ACTOR, {
      permissionCode: 'qc_review.approve', effect: 'ALLOW', reason: 'self grant',
    }, ACTOR, ACTOR_PERMISSIONS)).rejects.toBeInstanceOf(ForbiddenException);
  });

  /**
   * A self-DENY is not an escalation, but it is still an actor editing their own
   * authorization, which the audit story has to be able to exclude.
   */
  it('refuses a self-targeted DENY as well', async () => {
    const { service } = build();
    await expect(service.createOverride(ACTOR, {
      permissionCode: 'qc_review.approve', effect: 'DENY', reason: 'self suspend',
    }, ACTOR, ACTOR_PERMISSIONS)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a DENY for a permission the actor does not hold — a DENY grants nothing', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, {
      permissionCode: 'role.delete', effect: 'DENY', reason: 'suspended pending HR investigation',
    }, ACTOR, ['override.create']);
    expect(tx.userPermissionOverride.create).toHaveBeenCalled();
  });

  it('still lets an actor grant another user a permission the actor does hold', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, {
      permissionCode: 'qc_review.approve', effect: 'ALLOW', reason: 'Temporary QC cover',
    }, ACTOR, ['override.create', 'qc_review.approve']);
    expect(tx.userPermissionOverride.create).toHaveBeenCalled();
  });
});

/**
 * Global overrides are folded into the JWT `permissions` claim, so without a
 * revocation the change would not be enforced for up to the 15-minute access
 * token TTL — a suspension that takes effect a quarter of an hour later is not
 * a suspension. Bumping `tokenVersion` in the same transaction as the override
 * write makes the gateway kill the old token on the next request.
 */
describe('ScopesService — overrides take effect immediately', () => {
  const dto = { permissionCode: 'qc_review.approve', effect: 'DENY' as const, reason: 'suspended' };

  it('bumps the target user tokenVersion when an override is created', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, dto, ACTOR, ACTOR_PERMISSIONS);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: USER }, data: { tokenVersion: { increment: 1 } },
    });
  });

  it('publishes the bumped version through the same store AuthService uses', async () => {
    const { service, versions } = build();
    await service.createOverride(USER, dto, ACTOR, ACTOR_PERMISSIONS);
    expect(versions.publish).toHaveBeenCalledWith(USER, 7, 2_592_000);
  });

  it('bumps the target tokenVersion when an override is revoked', async () => {
    const { service, tx } = build();
    await service.revokeOverride(USER, OVERRIDE, ACTOR);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: USER }, data: { tokenVersion: { increment: 1 } },
    });
  });

  it('does not bump anything when the override write is refused', async () => {
    const { service, tx, versions } = build({ permission: null });
    await service.createOverride(USER, dto, ACTOR, ACTOR_PERMISSIONS).catch(() => undefined);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(versions.publish).not.toHaveBeenCalled();
  });

  it('does not bump anything when the revoked override does not exist', async () => {
    const { service, tx, versions } = build({ existingOverride: null });
    await service.revokeOverride(USER, OVERRIDE, ACTOR).catch(() => undefined);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(versions.publish).not.toHaveBeenCalled();
  });
});

describe('ScopesService.revokeOverride', () => {
  it('deletes the override', async () => {
    const { service, tx } = build();
    await service.revokeOverride(USER, OVERRIDE, ACTOR);
    expect(tx.userPermissionOverride.delete).toHaveBeenCalledWith({ where: { id: OVERRIDE } });
  });

  it('audits the revoke against the override owner', async () => {
    const { service, tx } = build();
    await service.revokeOverride(USER, OVERRIDE, ACTOR);
    expect(subjectsOf(tx)).toContain('audit.event.recorded');
  });

  it('rejects an unknown override id', async () => {
    const { service } = build({ existingOverride: null });
    await expect(service.revokeOverride(USER, OVERRIDE, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * The route is `DELETE /users/:id/permission-overrides/:overrideId` but `:id`
   * was never read and the lookup was by override id alone, so a stale or
   * guessed id mutated a third party — and every URL-based access log recorded
   * the wrong user while the audit event recorded the real one. `NotFound`, not
   * `Forbidden`: the override's existence must not be disclosed.
   */
  it('refuses an override that belongs to a different user', async () => {
    const { service } = build({ existingOverride: { id: OVERRIDE, userId: uuidv7() } });
    await expect(service.revokeOverride(USER, OVERRIDE, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not delete an override that belongs to a different user', async () => {
    const { service, tx } = build({ existingOverride: { id: OVERRIDE, userId: uuidv7() } });
    await service.revokeOverride(USER, OVERRIDE, ACTOR).catch(() => undefined);
    expect(tx.userPermissionOverride.delete).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  /**
   * `createOverride` refuses a self-targeted override; without the same rule
   * here the identical escalation is available through a cheaper permission.
   * `override.revoke` closes over only `override.view`, so a user suspended by
   * a DENY override and holding it could delete their own suspension — and
   * because the revoke bumps their `tokenVersion`, their next token is minted
   * with the permission restored. `Forbidden`, not `NotFound`: unlike the
   * wrong-owner case there is nothing to conceal, since the actor already
   * knows their own id.
   */
  it('refuses to revoke an override on the actor\'s own account', async () => {
    const { service } = build();
    await expect(service.revokeOverride(ACTOR, OVERRIDE, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deletes nothing when the actor targets themselves', async () => {
    const { service, tx } = build();
    await service.revokeOverride(ACTOR, OVERRIDE, ACTOR).catch(() => undefined);
    expect(tx.userPermissionOverride.delete).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('ScopesService.listForUser', () => {
  it('returns the project and site ids the user holds', async () => {
    const { service } = build();
    await expect(service.listForUser(USER)).resolves.toEqual({ global: false, projectIds: [PROJECT], siteIds: [SITE] });
  });

  /**
   * `listForUser` also returned every override, including its free-text
   * `reason` — the most sensitive field in the model, carrying text like
   * "suspended pending HR investigation" — to any holder of `scope.view`, whose
   * dependency closure does not include `override.view`. Overrides moved to
   * `GET /users/:id/permission-overrides`, which requires `override.view`.
   */
  it('does not return overrides, which need override.view', async () => {
    const { service } = build({
      overrides: [{
        id: uuidv7(), permission: { code: 'qc_review.approve' }, effect: 'DENY',
        projectId: null, siteId: null, validFrom: null, validUntil: null,
        reason: 'suspended pending HR investigation',
      }],
    });
    expect(await service.listForUser(USER)).not.toHaveProperty('overrides');
  });

  it('does not even query the override table', async () => {
    const { service, prisma } = build();
    await service.listForUser(USER);
    expect(prisma.userPermissionOverride.findMany).not.toHaveBeenCalled();
  });
});

describe('ScopesService.listOverridesForUser', () => {
  const row = {
    id: OVERRIDE, permission: { code: 'qc_review.approve' }, effect: 'DENY',
    projectId: null, siteId: null,
    validFrom: null, validUntil: new Date('2026-09-30T00:00:00.000Z'),
    reason: 'suspended pending HR investigation',
  };

  it('returns the overrides with their permission codes', async () => {
    const { service } = build({ overrides: [row] });
    const result = await service.listOverridesForUser(USER);
    expect(result[0]).toMatchObject({ id: OVERRIDE, permissionCode: 'qc_review.approve', effect: 'DENY' });
  });

  it('returns the reason, which is the point of the endpoint', async () => {
    const { service } = build({ overrides: [row] });
    expect((await service.listOverridesForUser(USER))[0]?.reason).toBe('suspended pending HR investigation');
  });

  it('serialises validity dates as ISO strings', async () => {
    const { service } = build({ overrides: [row] });
    const result = await service.listOverridesForUser(USER);
    expect(result[0]).toMatchObject({ validFrom: null, validUntil: '2026-09-30T00:00:00.000Z' });
  });

  it('returns an empty list for a user with no overrides', async () => {
    const { service } = build({ overrides: [] });
    await expect(service.listOverridesForUser(USER)).resolves.toEqual([]);
  });
});

describe('ScopesService.grantGlobal', () => {
  it('creates the row and emits a GLOBAL scope event', async () => {
    const { service, tx } = build();
    await service.grantGlobal(USER, ACTOR);
    expect(tx.userGlobalScope.create).toHaveBeenCalled();
    expect(payloadsOf(tx, 'iam.scope.granted')).toEqual([
      { userId: USER, level: 'GLOBAL', projectId: null, siteId: null },
    ]);
  });

  it('audits the grant', async () => {
    const { service, tx } = build();
    await service.grantGlobal(USER, ACTOR);
    expect(subjectsOf(tx)).toContain('audit.event.recorded');
  });

  it('bumps the token version so the change takes effect immediately', async () => {
    // Global scope changes the answer to every authorization question at once.
    // Unlike a project grant -- which each service re-reads from its own
    // projection on the next request -- an outstanding token must not survive
    // this for up to its full TTL.
    const { service, versions } = build();
    await service.grantGlobal(USER, ACTOR);
    expect(versions.publish).toHaveBeenCalled();
  });

  it('is idempotent: a second grant writes no row and emits nothing', async () => {
    const { service, tx } = build({ existingGlobalScope: { id: uuidv7() } });
    await service.grantGlobal(USER, ACTOR);
    expect(tx.userGlobalScope.create).not.toHaveBeenCalled();
    expect(subjectsOf(tx)).toEqual([]);
  });

  it('refuses an actor granting global scope to their own account', async () => {
    // The same self-escalation rule createOverride enforces. Granting yourself
    // global reach is the single largest privilege escalation available.
    const { service } = build();
    await expect(service.grantGlobal(ACTOR, ACTOR)).rejects.toThrow(/own account/i);
  });

  it('refuses a user that does not exist', async () => {
    const { service } = build({ user: null });
    await expect(service.grantGlobal(USER, ACTOR)).rejects.toThrow(/not found/i);
  });
});

describe('ScopesService.revokeGlobal', () => {
  it('emits a GLOBAL revocation and bumps the token version', async () => {
    const { service, tx, versions } = build({ existingGlobalScope: { id: uuidv7() } });
    await service.revokeGlobal(USER, ACTOR);
    expect(payloadsOf(tx, 'iam.scope.revoked')).toEqual([
      { userId: USER, level: 'GLOBAL', projectId: null, siteId: null },
    ]);
    expect(versions.publish).toHaveBeenCalled();
  });

  it('does nothing when the user had no global scope', async () => {
    const { service, tx, versions } = build();
    await service.revokeGlobal(USER, ACTOR);
    expect(subjectsOf(tx)).toEqual([]);
    expect(versions.publish).not.toHaveBeenCalled();
  });

  it('refuses an actor revoking global scope from their own account', async () => {
    const { service } = build({ existingGlobalScope: { id: uuidv7() } });
    await expect(service.revokeGlobal(ACTOR, ACTOR)).rejects.toThrow(/own account/i);
  });
});

describe('ScopesService.listForUser', () => {
  it('reports global reach as its own flag, not as empty lists', async () => {
    // Empty project and site lists mean "granted nothing", which is the
    // opposite of global reach. A scope screen that inferred one from the other
    // would tell an operator the reverse of the truth.
    const { service } = build({ globalScopeRow: { id: uuidv7() } });
    expect(await service.listForUser(USER)).toEqual({
      global: true, projectIds: [PROJECT], siteIds: [SITE],
    });
  });

  it('reports no global reach when there is no grant', async () => {
    const { service } = build();
    expect(await service.listForUser(USER)).toMatchObject({ global: false });
  });
});
