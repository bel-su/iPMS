import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { uuidv7 } from '@ipms/contracts';

const passwords = new PasswordService();
const tokens = new TokenService({ secret: 'a'.repeat(32), accessTtl: 900, refreshTtl: 2_592_000 });

async function build(userOverrides: Record<string, unknown> = {}) {
  const user = {
    id: uuidv7(), username: 'engineer', isActive: true, tokenVersion: 0,
    passwordHash: await passwords.hash('demo12345'),
    roles: [{ role: { code: 'FIELD_ENGINEER', isActive: true, permissions: [{ permission: { code: 'task.view' } }] },
             validFrom: null, validUntil: null }],
    overrides: [],
    ...userOverrides,
  };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({ ...user, tokenVersion: (user['tokenVersion'] as number) + 1 }),
    },
  };
  const versions = { publish: vi.fn().mockResolvedValue(undefined) };
  return { service: new AuthService(prisma as never, passwords, tokens, versions), prisma, versions, user };
}

describe('AuthService.login', () => {
  it('returns a token pair for valid credentials', async () => {
    const { service } = await build();
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(pair.accessToken).toBeTruthy();
  });

  it('embeds the permissions derived from active roles', async () => {
    const { service } = await build();
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });

  it('rejects a wrong password with 401', async () => {
    const { service } = await build();
    await expect(service.login({ username: 'engineer', password: 'wrong-password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown user with 401', async () => {
    const { service, prisma } = await build();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ username: 'ghost', password: 'demo12345' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('gives the same message for unknown user and wrong password, to avoid enumeration', async () => {
    const { service, prisma } = await build();
    const wrongPassword = await service.login({ username: 'engineer', password: 'wrong-password' }).catch((e: Error) => e.message);
    prisma.user.findUnique.mockResolvedValue(null);
    const unknownUser = await service.login({ username: 'ghost', password: 'demo12345' }).catch((e: Error) => e.message);
    expect(wrongPassword).toBe(unknownUser);
  });

  it('rejects a deactivated user', async () => {
    const { service } = await build({ isActive: false });
    await expect(service.login({ username: 'engineer', password: 'demo12345' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('excludes permissions from an expired role assignment', async () => {
    const { service } = await build({
      roles: [{
        role: { code: 'QC_MANAGER', isActive: true, permissions: [{ permission: { code: 'qc_review.approve' } }] },
        validFrom: null, validUntil: new Date('2026-01-01T00:00:00Z'),
      }],
    });
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('qc_review.approve');
  });

  it('excludes permissions from an inactive role', async () => {
    const { service } = await build({
      roles: [{
        role: { code: 'QC_MANAGER', isActive: false, permissions: [{ permission: { code: 'qc_review.approve' } }] },
        validFrom: null, validUntil: null,
      }],
    });
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toEqual([]);
  });
});

/**
 * The JWT `permissions` claim is where the architecture puts permission codes,
 * so it is where a global override has to land. Deriving the claim from role
 * assignments alone is what made a DENY override cosmetic: the row was written
 * and audited, both read endpoints reported the suspension, and the user's token
 * still carried the permission.
 */
function globalOverride(
  code: string, effect: 'ALLOW' | 'DENY', extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    permission: { code }, effect,
    projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'test', ...extra,
  };
}

describe('AuthService — overrides in the permission claim', () => {
  it('drops a role-granted permission denied by a live global override', async () => {
    const { service } = await build({ overrides: [globalOverride('task.view', 'DENY')] });
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('task.view');
  });

  it('adds a permission granted by a live global ALLOW override', async () => {
    const { service } = await build({ overrides: [globalOverride('qc_review.approve', 'ALLOW')] });
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('qc_review.approve');
  });

  it('lets a DENY win over an ALLOW for the same permission', async () => {
    const { service } = await build({
      overrides: [
        globalOverride('qc_review.approve', 'ALLOW'),
        globalOverride('qc_review.approve', 'DENY'),
      ],
    });
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('qc_review.approve');
  });

  it('ignores an expired override', async () => {
    const { service } = await build({
      overrides: [globalOverride('task.view', 'DENY', { validUntil: new Date('2026-01-01T00:00:00Z') })],
    });
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });

  /**
   * A project-scoped override must not reach the claim: the claim carries no
   * resource, so folding one in would apply it in every project. Those are
   * enforced by `AuthzGuard` through `OVERRIDE_PROVIDER`, where a resource is
   * in hand.
   */
  it('leaves a project-scoped override out of the claim', async () => {
    const { service } = await build({
      overrides: [globalOverride('task.view', 'DENY', { projectId: 'p-1' })],
    });
    const pair = await service.login({ username: 'engineer', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });

  it('applies overrides on refresh too, not only on login', async () => {
    const { service, prisma, user } = await build();
    const { refreshToken } = await service.login({ username: 'engineer', password: 'demo12345' });
    prisma.user.findUnique.mockResolvedValue({ ...user, overrides: [globalOverride('task.view', 'DENY')] });
    const pair = await service.refresh(refreshToken);
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('task.view');
  });
});

describe('AuthService.revokeAll', () => {
  it('bumps the token version and publishes it', async () => {
    const { service, prisma, versions, user } = await build();
    await service.revokeAll(user.id as string);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tokenVersion: { increment: 1 } } }),
    );
    expect(versions.publish).toHaveBeenCalled();
  });

  it('publishes the incremented version, not the stale one', async () => {
    const { service, versions, user } = await build({ tokenVersion: 4 });
    await service.revokeAll(user.id as string);
    expect(versions.publish).toHaveBeenCalledWith(user.id, 5, expect.any(Number));
  });
});

/**
 * The gateway refuses any token whose user has no published version, so the
 * cache entry is not an optimisation — it is a precondition for the token
 * being usable at all. Publishing only on revocation (the original shape) meant
 * a Redis eviction or restart erased every revocation on record and quietly
 * reinstated the tokens it was meant to kill.
 */
describe('AuthService — session version publication', () => {
  it('publishes the token version on login, not only on revocation', async () => {
    const { service, versions, user } = await build({ tokenVersion: 2 });
    await service.login({ username: 'engineer', password: 'demo12345' });
    expect(versions.publish).toHaveBeenCalledWith(user.id, 2, expect.any(Number));
  });

  it('publishes the token version on refresh too', async () => {
    const { service, versions, user } = await build({ tokenVersion: 2 });
    const { refreshToken } = await service.login({ username: 'engineer', password: 'demo12345' });
    versions.publish.mockClear();
    await service.refresh(refreshToken);
    expect(versions.publish).toHaveBeenCalledWith(user.id, 2, expect.any(Number));
  });

  it('gives the entry a TTL at least as long as a refresh token lives', async () => {
    const { service, versions } = await build();
    await service.login({ username: 'engineer', password: 'demo12345' });
    const ttl = versions.publish.mock.calls[0]?.[2] as number;
    expect(ttl).toBeGreaterThanOrEqual(2_592_000);
  });
});

describe('AuthService.refresh', () => {
  it('rejects an access token presented as a refresh token', async () => {
    const { service } = await build();
    const { accessToken } = await service.login({ username: 'engineer', password: 'demo12345' });
    await expect(service.refresh(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token whose version no longer matches the user', async () => {
    const { service, prisma, user } = await build({ tokenVersion: 1 });
    const { refreshToken } = await service.login({ username: 'engineer', password: 'demo12345' });
    prisma.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 2 });
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token for a user deactivated since it was issued', async () => {
    const { service, prisma, user } = await build();
    const { refreshToken } = await service.login({ username: 'engineer', password: 'demo12345' });
    prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues a fresh pair for a valid refresh token', async () => {
    const { service } = await build();
    const { refreshToken } = await service.login({ username: 'engineer', password: 'demo12345' });
    const pair = await service.refresh(refreshToken);
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });
});
