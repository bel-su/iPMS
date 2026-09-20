import type { LoginDto, TokenPair } from '@ipms/contracts';

/**
 * The session boundary: everything that mints, renews, revokes or stores the
 * token pair lives here, and nothing else in the web app touches a cookie.
 *
 * Deliberately free of runtime imports from `@ipms/contracts` — the types are
 * erased at compile time. The contracts barrel pulls in `node:crypto` (uuidv7)
 * and zod, and this module is imported by the middleware, which Next bundles
 * for the edge runtime where `node:crypto` is not available. That is why the
 * token pair is checked by a hand-written guard below rather than by
 * `TokenPairSchema.safeParse`.
 */

export const ACCESS_COOKIE = 'ipms_access_token';
export const REFRESH_COOKIE = 'ipms_refresh_token';

/** Matches JWT_REFRESH_TTL's default (30 days); the gateway rejects it sooner if configured shorter. */
const REFRESH_MAX_AGE_SECONDS = 2_592_000;

export type TokenResult =
  /** The gateway issued a pair. */
  | { state: 'ok'; tokens: TokenPair }
  /** The gateway answered, and said no: bad credentials, or a dead refresh token. */
  | { state: 'rejected' }
  /** No usable answer — unreachable, 5xx, or a malformed body. Says nothing about the credentials. */
  | { state: 'unavailable' };

export type SessionAction =
  | { action: 'pass' }
  | { action: 'renew'; tokens: TokenPair }
  | { action: 'clear' };

/**
 * Read per call rather than captured at module load, so one standalone build
 * can run against a gateway at a different address in every environment.
 */
export function apiBaseUrl(): string {
  const configured = process.env['IPMS_API_BASE_URL'];
  const base = configured && configured.length > 0 ? configured : 'http://127.0.0.1:3000';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function isTokenPair(value: unknown): value is TokenPair {
  if (typeof value !== 'object' || value === null) return false;
  const pair = value as Record<string, unknown>;
  return typeof pair['accessToken'] === 'string' && pair['accessToken'].length > 0
    && typeof pair['refreshToken'] === 'string' && pair['refreshToken'].length > 0
    && typeof pair['expiresIn'] === 'number' && Number.isFinite(pair['expiresIn']) && pair['expiresIn'] > 0;
}

/**
 * Both token-minting calls answer the same three ways, and the difference
 * between "refused" and "could not ask" is the whole point: only the first
 * means the caller's credentials are wrong.
 */
async function mintTokens(path: string, body: unknown): Promise<TokenResult> {
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (response.status === 401 || response.status === 403) return { state: 'rejected' };
    if (!response.ok) return { state: 'unavailable' };

    const payload: unknown = await response.json();
    return isTokenPair(payload) ? { state: 'ok', tokens: payload } : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}

export async function loginWithPassword(credentials: LoginDto): Promise<TokenResult> {
  return mintTokens('/api/v1/auth/login', credentials);
}

export async function refreshTokens(refreshToken: string): Promise<TokenResult> {
  return mintTokens('/api/v1/auth/refresh', { refreshToken });
}

/**
 * Best-effort revocation. The caller clears the browser's cookies whatever
 * happens here, so a failure must not propagate: a user who cannot reach the
 * gateway must still be able to sign out of this browser.
 */
export async function revokeSession(accessToken: string): Promise<void> {
  try {
    await fetch(`${apiBaseUrl()}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch {
    // Intentionally ignored — see above.
  }
}

/** The cookie-writing surface of NextResponse, named so this module can be tested without one. */
export interface CookieJar {
  cookies: {
    set(name: string, value: string, options: {
      httpOnly: boolean; sameSite: 'lax'; secure: boolean; path: string; maxAge: number;
    }): unknown;
  };
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge,
  };
}

/**
 * Stores the pair.
 *
 * The access cookie is given the access token's own lifetime, which is what
 * turns the cookie's absence into a trustworthy "expired" signal: the browser
 * drops it at the same moment the gateway starts refusing it, and that is the
 * only trigger the middleware needs to renew.
 */
export function writeSession(response: CookieJar, tokens: TokenPair): void {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.expiresIn));
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS));
}

export function clearSession(response: CookieJar): void {
  response.cookies.set(ACCESS_COOKIE, '', cookieOptions(0));
  response.cookies.set(REFRESH_COOKIE, '', cookieOptions(0));
}

/**
 * Decides what a request's cookies mean, given a way to redeem a refresh
 * token. Pure apart from the injected call, so the renewal rules are testable
 * without a Next request; `middleware.ts` is the glue that applies the answer.
 */
export async function resolveSession(
  cookies: { access?: string | undefined; refresh?: string | undefined },
  redeem: (refreshToken: string) => Promise<TokenResult>,
): Promise<SessionAction> {
  if (cookies.access) return { action: 'pass' };
  if (!cookies.refresh) return { action: 'pass' };

  const result = await redeem(cookies.refresh);
  if (result.state === 'ok') return { action: 'renew', tokens: result.tokens };
  // Refused means the token is dead — logged out elsewhere, or iam bumped the
  // token version. Unavailable says nothing about it, so the session stands
  // rather than signing everyone out whenever the stack restarts.
  return result.state === 'rejected' ? { action: 'clear' } : { action: 'pass' };
}
