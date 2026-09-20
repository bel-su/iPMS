import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './session';

const { proxy, config } = await import('../../proxy');

const TOKENS = { accessToken: 'fresh.access.jwt', refreshToken: 'fresh.refresh.jwt', expiresIn: 900 };

function request(cookies: Record<string, string>): NextRequest {
  const next = new NextRequest('http://localhost:3100/');
  for (const [name, value] of Object.entries(cookies)) next.cookies.set(name, value);
  return next;
}

function tokenResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('proxy — session renewal', () => {
  it('does not call the gateway while the access cookie is live', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await proxy(request({ [ACCESS_COOKIE]: 'live.jwt', [REFRESH_COOKIE]: 'refresh.jwt' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.cookies.get(ACCESS_COOKIE)).toBeUndefined();
  });

  it('does not call the gateway for an anonymous visitor', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await proxy(request({}));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The gap this closes: the access cookie has expired, the refresh cookie has
  // not, and before this the user was simply shown a sign-in page.
  it('renews an expired session and stores the new pair', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse(200, TOKENS)));

    const response = await proxy(request({ [REFRESH_COOKIE]: 'refresh.jwt' }));

    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe('fresh.access.jwt');
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe('fresh.refresh.jwt');
    expect(response.cookies.get(ACCESS_COOKIE)?.maxAge).toBe(900);
  });

  it('clears both cookies when the refresh token is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse(401, { error: { code: 'UNAUTHENTICATED' } })));

    const response = await proxy(request({ [REFRESH_COOKIE]: 'revoked.jwt' }));

    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe('');
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe('');
    expect(response.cookies.get(REFRESH_COOKIE)?.maxAge).toBe(0);
  });

  it('leaves the session alone when the gateway is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const response = await proxy(request({ [REFRESH_COOKIE]: 'refresh.jwt' }));

    expect(response.cookies.get(REFRESH_COOKIE)).toBeUndefined();
  });
});

describe('proxy — where it runs', () => {
  const matcher = config.matcher[0]!;
  const matches = (path: string): boolean => new RegExp(`^${matcher}$`).test(path);

  it('runs on pages', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/login')).toBe(true);
  });

  // These handlers own the session themselves; renewing on the way into
  // logout would mint a pair a moment before revoking it.
  it('does not run on the auth route handlers', () => {
    expect(matches('/api/auth/login')).toBe(false);
    expect(matches('/api/auth/logout')).toBe(false);
  });

  // Renewal on asset requests would fire several gateway calls per page load,
  // racing each other to store different pairs.
  it('does not run on static assets', () => {
    expect(matches('/_next/static/chunk.js')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
  });
});
