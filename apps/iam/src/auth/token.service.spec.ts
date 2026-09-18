import { describe, expect, it } from 'vitest';
import { TokenService } from './token.service.js';
import { uuidv7 } from '@ipms/contracts';

const svc = new TokenService({ secret: 'a'.repeat(32), accessTtl: 900, refreshTtl: 2_592_000 });
const user = { id: uuidv7(), tokenVersion: 3 };
const roles = ['FIELD_ENGINEER'];
const permissions = ['task.view', 'task.update'];

describe('TokenService', () => {
  it('issues an access and refresh token pair', () => {
    const pair = svc.issue(user, roles, permissions);
    expect(pair.accessToken.split('.')).toHaveLength(3);
    expect(pair.refreshToken.split('.')).toHaveLength(3);
    expect(pair.expiresIn).toBe(900);
  });

  it('issues two distinct tokens, not the same string twice', () => {
    const pair = svc.issue(user, roles, permissions);
    expect(pair.accessToken).not.toBe(pair.refreshToken);
  });

  it('embeds subject, roles, permissions, and token version', () => {
    const { accessToken } = svc.issue(user, roles, permissions);
    const payload = svc.verifyAccess(accessToken);
    expect(payload.sub).toBe(user.id);
    expect(payload.roles).toEqual(roles);
    expect(payload.permissions).toEqual(permissions);
    expect(payload.tokenVersion).toBe(3);
  });

  it('never embeds scope lists', () => {
    const { accessToken } = svc.issue(user, roles, permissions);
    const payload = svc.verifyAccess(accessToken);
    expect(payload).not.toHaveProperty('projectIds');
    expect(payload).not.toHaveProperty('siteIds');
  });

  it('rejects a token signed with a different secret', () => {
    const other = new TokenService({ secret: 'b'.repeat(32), accessTtl: 900, refreshTtl: 2_592_000 });
    const { accessToken } = other.issue(user, roles, permissions);
    expect(() => svc.verifyAccess(accessToken)).toThrow();
  });

  it('rejects a tampered token', () => {
    const { accessToken } = svc.issue(user, roles, permissions);
    const [h, , s] = accessToken.split('.');
    const tampered = `${h}.${Buffer.from('{"sub":"evil"}').toString('base64url')}.${s}`;
    expect(() => svc.verifyAccess(tampered)).toThrow();
  });

  it('rejects an expired token', () => {
    const shortLived = new TokenService({ secret: 'a'.repeat(32), accessTtl: -1, refreshTtl: 10 });
    const { accessToken } = shortLived.issue(user, roles, permissions);
    expect(() => shortLived.verifyAccess(accessToken)).toThrow();
  });

  it('marks the refresh token so it cannot be used as an access token', () => {
    const { refreshToken } = svc.issue(user, roles, permissions);
    expect(() => svc.verifyAccess(refreshToken)).toThrow();
  });

  it('marks the access token so it cannot be redeemed for a new pair', () => {
    const { accessToken } = svc.issue(user, roles, permissions);
    expect(() => svc.verifyRefresh(accessToken)).toThrow();
  });

  it('accepts its own refresh token as a refresh token', () => {
    const { refreshToken } = svc.issue(user, roles, permissions);
    expect(svc.verifyRefresh(refreshToken).sub).toBe(user.id);
  });

  it('gives the refresh token the longer of the two lifetimes', () => {
    const pair = svc.issue(user, roles, permissions);
    const access = svc.verifyAccess(pair.accessToken);
    const refresh = svc.verifyRefresh(pair.refreshToken);
    expect(refresh.exp - refresh.iat).toBe(2_592_000);
    expect(access.exp - access.iat).toBe(900);
  });
});
