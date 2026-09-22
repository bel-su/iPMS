import { describe, expect, it } from 'vitest';
import { isPublicPath, normalizeTarget, resolveUpstream, ROUTES } from './routes.js';

describe('resolveUpstream — allowlist', () => {
  it('routes an exact prefix match', () => {
    expect(resolveUpstream('/api/v1/auth')?.service).toBe('iam');
  });

  it('routes a nested path under a prefix', () => {
    expect(resolveUpstream('/api/v1/auth/login')?.service).toBe('iam');
  });

  it('routes the audit prefix to the audit service', () => {
    const upstream = resolveUpstream('/api/v1/audit/events');
    expect(upstream?.service).toBe('audit');
    expect(upstream?.port).toBe(3003);
  });

  it('routes the project prefixes to the project service', () => {
    for (const path of [
      '/api/v1/dashboard', '/api/v1/projects', '/api/v1/projects/x/sites', '/api/v1/projects/x/tasks',
      '/api/v1/tasks/x/assign', '/api/v1/sites/x', '/api/v1/task-types/x', '/api/v1/milestones/x',
    ]) {
      const upstream = resolveUpstream(path);
      expect(upstream?.service).toBe('project');
      expect(upstream?.port).toBe(3004);
    }
  });

  it('does not reach an internal path under a new prefix', () => {
    expect(resolveUpstream('/api/v1/sites/internal/secrets')).toBeUndefined();
  });

  it('routes the qc prefix to the qc service', () => {
    const upstream = resolveUpstream('/api/v1/qc/submissions');
    expect(upstream?.service).toBe('qc');
    expect(upstream?.port).toBe(3005);
  });

  it('routes the media prefix to the media service', () => {
    const upstream = resolveUpstream('/api/v1/media/objects');
    expect(upstream?.service).toBe('media');
    expect(upstream?.port).toBe(3006);
  });

  it('keeps media internal paths private', () => {
    expect(resolveUpstream('/api/v1/media/internal/objects')).toBeUndefined();
  });

  it('keeps the media prefix authenticated', () => {
    expect(isPublicPath('/api/v1/media')).toBe(false);
    expect(isPublicPath('/api/v1/media/objects')).toBe(false);
  });

  it('routes the notifications prefix to the notification service', () => {
    const upstream = resolveUpstream('/api/v1/notifications');
    expect(upstream?.service).toBe('notification');
    expect(upstream?.port).toBe(3007);
  });

  it('keeps the notifications prefix authenticated', () => {
    expect(isPublicPath('/api/v1/notifications')).toBe(false);
  });

  it('routes the docs prefix to the docs service', () => {
    const upstream = resolveUpstream('/api/v1/docs/getting-started');
    expect(upstream?.service).toBe('docs');
    expect(upstream?.port).toBe(3008);
  });

  /**
   * "Platform documentation" sounds public. It is not: the documentation
   * describes this system's internals to its operators. If a genuinely public
   * subset is ever wanted it must be an explicit, narrow PUBLIC_PATHS entry
   * argued on its own merits — never a prefix rule, for the reason the comment
   * above PUBLIC_PATHS gives.
   */
  it('keeps the docs prefix authenticated', () => {
    expect(isPublicPath('/api/v1/docs')).toBe(false);
    expect(isPublicPath('/api/v1/docs/getting-started')).toBe(false);
  });

  it('refuses a path on no declared prefix', () => {
    expect(resolveUpstream('/api/v1/billing')).toBeUndefined();
  });

  it('refuses a prefix that only shares a string prefix with a route', () => {
    // '/api/v1/authorization' must not match the '/api/v1/auth' route.
    expect(resolveUpstream('/api/v1/authorization/x')).toBeUndefined();
  });

  it('refuses the bare root', () => {
    expect(resolveUpstream('/')).toBeUndefined();
  });

  it('prefers the longest matching prefix', () => {
    const longest = [...ROUTES].sort((a, b) => b.prefix.length - a.prefix.length)[0];
    expect(resolveUpstream(`${longest?.prefix ?? ''}/x`)?.prefix).toBe(longest?.prefix);
  });
});

describe('resolveUpstream — query strings', () => {
  // A bare prefix with a query string matched nothing before, because the raw
  // URL was neither equal to the prefix nor prefixed by `prefix + '/'`.
  it('routes a bare prefix carrying a query string', () => {
    expect(resolveUpstream('/api/v1/auth?next=%2Fdashboard')?.service).toBe('iam');
  });

  it('routes a nested path carrying a query string', () => {
    expect(resolveUpstream('/api/v1/audit/events?limit=50&cursor=abc')?.service).toBe('audit');
  });

  it('keeps the query string separate from the path', () => {
    expect(normalizeTarget('/api/v1/audit/events?limit=50')).toEqual({
      path: '/api/v1/audit/events', query: '?limit=50',
    });
  });

  it('does not let a query string smuggle an internal path into the route check', () => {
    expect(resolveUpstream('/api/v1/audit/events?redirect=/internal/secrets')?.service).toBe('audit');
  });
});

describe('resolveUpstream — internal routes stay private', () => {
  it('refuses an /internal/ path', () => {
    expect(resolveUpstream('/api/v1/audit/internal/authz/explain')).toBeUndefined();
  });

  it('refuses the site geofence lookup', () => {
    expect(resolveUpstream('/api/v1/internal/sites/abc/geofence')).toBeUndefined();
  });

  it('refuses a bare /internal path', () => {
    expect(resolveUpstream('/internal')).toBeUndefined();
  });

  // The guard ran on the raw URL before, so a percent-encoded spelling reached
  // the upstream, which decodes it — the block was bypassable by encoding.
  // Now refused because the path carries a percent-escape at all.
  it('refuses a percent-encoded /internal/ path', () => {
    expect(resolveUpstream('/api/v1/audit/%69nternal/authz')).toBeUndefined();
  });
});

describe('resolveUpstream — traversal', () => {
  it('refuses a literal dot-dot segment', () => {
    expect(resolveUpstream('/api/v1/audit/../../internal/secrets')).toBeUndefined();
  });

  it('refuses a percent-encoded dot-dot segment', () => {
    expect(resolveUpstream('/api/v1/audit/%2e%2e%2f%2e%2e%2finternal')).toBeUndefined();
  });

  // A single decode leaves this looking like the harmless literal
  // `%2e%2e%2finternal`; decode once more and it is `../internal`. No fixed
  // number of decode rounds is safe, which is why the path may not carry a
  // percent-escape at all.
  it('refuses a double-encoded dot-dot segment', () => {
    expect(resolveUpstream('/api/v1/audit/%252e%252e%252finternal')).toBeUndefined();
  });

  it('refuses any percent-escape in the path, however innocuous', () => {
    expect(resolveUpstream('/api/v1/audit/ev%65nts')).toBeUndefined();
  });

  it('still allows a percent-escape in the query string', () => {
    expect(resolveUpstream('/api/v1/audit/events?q=a%20b')?.service).toBe('audit');
  });

  it('refuses a backslash, which some upstream stacks treat as a separator', () => {
    expect(resolveUpstream('/api/v1/audit\\..\\internal')).toBeUndefined();
  });

  it('refuses a null byte', () => {
    expect(resolveUpstream('/api/v1/audit/events%00.json')).toBeUndefined();
  });

  it('refuses a raw null byte too', () => {
    expect(resolveUpstream('/api/v1/audit/events\0.json')).toBeUndefined();
  });

  it('refuses malformed percent-encoding rather than guessing', () => {
    expect(resolveUpstream('/api/v1/audit/%zz')).toBeUndefined();
  });

  it('refuses a path that is not absolute', () => {
    expect(resolveUpstream('api/v1/auth')).toBeUndefined();
  });
});

describe('normalizeTarget — path cleanup', () => {
  it('collapses duplicate slashes', () => {
    expect(normalizeTarget('/api//v1///auth')?.path).toBe('/api/v1/auth');
  });

  it('drops single-dot segments', () => {
    expect(normalizeTarget('/api/v1/./auth')?.path).toBe('/api/v1/auth');
  });

  it('still routes a path that needed collapsing', () => {
    expect(resolveUpstream('/api//v1/auth//login')?.service).toBe('iam');
  });

  it('leaves a clean path unchanged', () => {
    expect(normalizeTarget('/api/v1/auth/login')).toEqual({ path: '/api/v1/auth/login', query: '' });
  });
});

describe('isPublicPath — the only unauthenticated proxied routes', () => {
  it('lets login through, or no caller could ever obtain a token', () => {
    expect(isPublicPath('/api/v1/auth/login')).toBe(true);
  });

  it('lets refresh through, since it is redeemed once the access token has expired', () => {
    expect(isPublicPath('/api/v1/auth/refresh')).toBe(true);
  });

  /**
   * Matched exactly, never by prefix. A prefix rule on `/api/v1/auth` would
   * expose these two: `logout` revokes a session, and `me` discloses the
   * caller's roles and permissions.
   */
  it('keeps logout authenticated', () => {
    expect(isPublicPath('/api/v1/auth/logout')).toBe(false);
  });

  it('keeps me authenticated', () => {
    expect(isPublicPath('/api/v1/auth/me')).toBe(false);
  });

  it('keeps every other route authenticated', () => {
    expect(isPublicPath('/api/v1/roles')).toBe(false);
    expect(isPublicPath('/api/v1/audit/events')).toBe(false);
  });

  it('is not fooled by a path that merely starts with a public one', () => {
    expect(isPublicPath('/api/v1/auth/login/../roles')).toBe(false);
    expect(isPublicPath('/api/v1/auth/loginX')).toBe(false);
  });

  it('normalizes before matching, so a redundant slash still logs in', () => {
    expect(isPublicPath('/api/v1//auth/login')).toBe(true);
  });

  it('allows a query string on a public path', () => {
    expect(isPublicPath('/api/v1/auth/login?next=/dashboard')).toBe(true);
  });
});
