import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './session';

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const { POST: login } = await import('../api/auth/login/route');
const { POST: logout } = await import('../api/auth/logout/route');

const TOKENS = { accessToken: 'access.jwt', refreshToken: 'refresh.jwt', expiresIn: 900 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function loginRequest(body: unknown, raw?: string): Request {
  return new Request('http://localhost:3100/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => { vi.unstubAllGlobals(); cookieStore.get.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('POST /api/auth/login', () => {
  it('stores both tokens as http-only cookies on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, TOKENS)));

    const response = await login(loginRequest({ username: 'ada', password: 'correct-horse' }));

    expect(response.status).toBe(200);
    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe('access.jwt');
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe('refresh.jwt');
    expect(response.cookies.get(ACCESS_COOKIE)?.httpOnly).toBe(true);
  });

  // The token must never be reachable from client script, so it is not in the
  // body either — the browser holds it only as an http-only cookie.
  it('does not return the tokens in the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, TOKENS)));

    const response = await login(loginRequest({ username: 'ada', password: 'correct-horse' }));

    expect(await response.text()).not.toContain('access.jwt');
  });

  it('answers 401 for bad credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } })));

    const response = await login(loginRequest({ username: 'ada', password: 'wrong-password' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Invalid username or password.' });
  });

  // Distinct from 401 on purpose: telling someone their password is wrong when
  // the gateway is simply down sends them to reset a working password.
  it('answers 503 when the gateway cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const response = await login(loginRequest({ username: 'ada', password: 'correct-horse' }));

    expect(response.status).toBe(503);
  });

  it('answers 400 for a body that is not a login attempt', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    for (const body of [{}, { username: 'ada' }, { username: '', password: 'correct-horse' }, { username: 1, password: 2 }]) {
      const response = await login(loginRequest(body));
      expect(response.status).toBe(400);
    }
    expect(await (await login(loginRequest(undefined, 'not json'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  function logoutRequest(): Request {
    return new Request('http://localhost:3100/api/auth/logout', { method: 'POST' });
  }

  it('revokes the session at iam and clears both cookies', async () => {
    cookieStore.get.mockReturnValue({ value: 'access.jwt' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await logout(logoutRequest());

    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:3000/api/v1/auth/logout');
    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe('');
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe('');
    expect(response.cookies.get(REFRESH_COOKIE)?.maxAge).toBe(0);
  });

  // Signing out of this browser must not depend on the platform being up.
  it('clears the cookies even when the gateway is unreachable', async () => {
    cookieStore.get.mockReturnValue({ value: 'access.jwt' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const response = await logout(logoutRequest());

    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe('');
  });

  it('redirects to the login page with a method-resetting 303', async () => {
    cookieStore.get.mockReturnValue(undefined);
    vi.stubGlobal('fetch', vi.fn());

    const response = await logout(logoutRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost:3100/login');
  });

  it('does not call the gateway when no token is held', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await logout(logoutRequest());

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
