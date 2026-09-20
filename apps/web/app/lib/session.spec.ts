import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  apiBaseUrl,
  clearSession,
  loginWithPassword,
  refreshTokens,
  resolveSession,
  revokeSession,
  writeSession,
} from './session';

const TOKENS = { accessToken: 'access.jwt', refreshToken: 'refresh.jwt', expiresIn: 900 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stands in for a NextResponse: only the cookie jar is used. */
function cookieJar() {
  const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
  return { set, cookies: { set: (name: string, value: string, options: Record<string, unknown>) => { set.push({ name, value, options }); } } };
}

beforeEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('apiBaseUrl', () => {
  // Read per call, not at module load: the standalone Next build is produced
  // once and run in environments that set a different gateway address.
  it('reads the environment at call time', () => {
    vi.stubEnv('IPMS_API_BASE_URL', 'http://gateway:3000');
    expect(apiBaseUrl()).toBe('http://gateway:3000');
  });

  it('falls back to the local gateway', () => {
    vi.stubEnv('IPMS_API_BASE_URL', '');
    expect(apiBaseUrl()).toBe('http://127.0.0.1:3000');
  });

  it('drops a trailing slash so paths never double up', () => {
    vi.stubEnv('IPMS_API_BASE_URL', 'http://gateway:3000/');
    expect(apiBaseUrl()).toBe('http://gateway:3000');
  });
});

describe('loginWithPassword', () => {
  it('posts the credentials to the gateway and returns the pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, TOKENS));
    vi.stubGlobal('fetch', fetchMock);

    const result = await loginWithPassword({ username: 'ada', password: 'correct-horse' });

    expect(result).toEqual({ state: 'ok', tokens: TOKENS });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3000/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'ada', password: 'correct-horse' });
  });

  it('reports bad credentials as rejected, not unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } })));
    expect(await loginWithPassword({ username: 'ada', password: 'wrong-password' })).toEqual({ state: 'rejected' });
  });

  it('reports an unreachable gateway as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await loginWithPassword({ username: 'ada', password: 'correct-horse' })).toEqual({ state: 'unavailable' });
  });

  // A 5xx is the gateway failing, not the password being wrong. Calling it
  // 'rejected' would tell the user their credentials are bad when they are not.
  it('reports a gateway error as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { error: { code: 'INTERNAL' } })));
    expect(await loginWithPassword({ username: 'ada', password: 'correct-horse' })).toEqual({ state: 'unavailable' });
  });

  // The pair is what every later request depends on. A 200 carrying something
  // else is a broken upstream, and storing it would produce a session that
  // cannot authenticate anything.
  it('refuses a 200 that is not a token pair', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { accessToken: 'only-half' })));
    expect(await loginWithPassword({ username: 'ada', password: 'correct-horse' })).toEqual({ state: 'unavailable' });
  });
});

describe('refreshTokens', () => {
  it('redeems the refresh token for a new pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, TOKENS));
    vi.stubGlobal('fetch', fetchMock);

    expect(await refreshTokens('refresh.jwt')).toEqual({ state: 'ok', tokens: TOKENS });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3000/api/v1/auth/refresh');
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'refresh.jwt' });
  });

  it('reports a revoked or expired refresh token as rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } })));
    expect(await refreshTokens('stale.jwt')).toEqual({ state: 'rejected' });
  });

  it('reports an unreachable gateway as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await refreshTokens('refresh.jwt')).toEqual({ state: 'unavailable' });
  });
});

describe('revokeSession', () => {
  it('sends the access token so iam can revoke the user session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeSession('access.jwt');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3000/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer access.jwt');
  });

  // Logging out must clear the browser's cookies even when the gateway cannot
  // be reached; the caller clears them unconditionally, so this must not throw.
  it('never throws when the gateway is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(revokeSession('access.jwt')).resolves.toBeUndefined();
  });
});

describe('writeSession', () => {
  it('stores both tokens http-only, scoped to the whole site', () => {
    const jar = cookieJar();
    writeSession(jar, TOKENS);

    const access = jar.set.find((c) => c.name === ACCESS_COOKIE);
    const refresh = jar.set.find((c) => c.name === REFRESH_COOKIE);
    expect(access?.value).toBe('access.jwt');
    expect(refresh?.value).toBe('refresh.jwt');
    for (const cookie of jar.set) {
      expect(cookie.options.httpOnly).toBe(true);
      expect(cookie.options.sameSite).toBe('lax');
      expect(cookie.options.path).toBe('/');
    }
  });

  // The access cookie's lifetime is the token's own lifetime. That is what
  // makes the cookie's absence a reliable "this token has expired" signal for
  // the middleware, which is the only thing that triggers a renewal.
  it('expires the access cookie exactly when the access token does', () => {
    const jar = cookieJar();
    writeSession(jar, TOKENS);
    expect(jar.set.find((c) => c.name === ACCESS_COOKIE)?.options.maxAge).toBe(900);
  });

  it('outlives the access cookie with the refresh cookie', () => {
    const jar = cookieJar();
    writeSession(jar, TOKENS);
    const refreshMaxAge = jar.set.find((c) => c.name === REFRESH_COOKIE)?.options.maxAge as number;
    expect(refreshMaxAge).toBeGreaterThan(900);
  });

  it('marks the cookies secure in production only', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const production = cookieJar();
    writeSession(production, TOKENS);
    expect(production.set.every((c) => c.options.secure === true)).toBe(true);

    vi.stubEnv('NODE_ENV', 'development');
    const development = cookieJar();
    writeSession(development, TOKENS);
    expect(development.set.every((c) => c.options.secure === false)).toBe(true);
  });
});

describe('clearSession', () => {
  it('overwrites both cookies with an immediate expiry', () => {
    const jar = cookieJar();
    clearSession(jar);
    expect(jar.set.map((c) => c.name).sort()).toEqual([ACCESS_COOKIE, REFRESH_COOKIE].sort());
    expect(jar.set.every((c) => c.value === '' && c.options.maxAge === 0)).toBe(true);
  });
});

describe('resolveSession', () => {
  it('passes a request through untouched while the access token is live', async () => {
    const refresh = vi.fn();
    expect(await resolveSession({ access: 'access.jwt', refresh: 'refresh.jwt' }, refresh)).toEqual({ action: 'pass' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('passes an anonymous request through without calling the gateway', async () => {
    const refresh = vi.fn();
    expect(await resolveSession({}, refresh)).toEqual({ action: 'pass' });
    expect(refresh).not.toHaveBeenCalled();
  });

  // The expired access cookie is gone but the refresh cookie remains: this is
  // the renewal the dashboard depended on and never had.
  it('renews when the access cookie has expired and a refresh token remains', async () => {
    const refresh = vi.fn().mockResolvedValue({ state: 'ok', tokens: TOKENS });
    expect(await resolveSession({ refresh: 'refresh.jwt' }, refresh)).toEqual({ action: 'renew', tokens: TOKENS });
    expect(refresh).toHaveBeenCalledWith('refresh.jwt');
  });

  // A refused refresh token is dead — the user logged out elsewhere, or iam
  // bumped their token version. Keeping the cookie would retry it on every
  // single navigation.
  it('clears the session when the refresh token is refused', async () => {
    const refresh = vi.fn().mockResolvedValue({ state: 'rejected' });
    expect(await resolveSession({ refresh: 'stale.jwt' }, refresh)).toEqual({ action: 'clear' });
  });

  // An unreachable gateway says nothing about the token's validity. Clearing
  // here would log every user out whenever the stack restarted.
  it('keeps the session when the gateway cannot be reached', async () => {
    const refresh = vi.fn().mockResolvedValue({ state: 'unavailable' });
    expect(await resolveSession({ refresh: 'refresh.jwt' }, refresh)).toEqual({ action: 'pass' });
  });
});
