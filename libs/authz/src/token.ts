import { createHmac, timingSafeEqual } from 'node:crypto';
import { TokenPayloadSchema, type TokenPayload, type TokenType } from '@ipms/contracts';

/**
 * The one HS256 token implementation in the platform.
 *
 * It lives in @ipms/authz rather than in the iam service because verification
 * is needed in three places — the gateway (which authenticates the edge), every
 * service's `JwtUserGuard` (zero-trust: a service reached directly must not
 * trust a header the gateway would have attached), and iam itself (to validate
 * a refresh token before minting a new pair). Those had drifted into three
 * separate implementations, one of which forgot to check the token kind and one
 * of which reached for `jsonwebtoken` with no algorithm allowlist. Any
 * disagreement between them is a security bug by construction, so there is
 * exactly one copy and both directions live here together: a change to the
 * signing format cannot be made without the verifier in the same file.
 */

/** Claims the caller supplies; `typ`, `iat` and `exp` are set by `signToken`. */
export interface TokenClaims {
  sub: string;
  roles: string[];
  permissions: string[];
  tokenVersion: number;
}

/** The browser's access-token cookie. Flutter and service callers use the Authorization header. */
export const ACCESS_COOKIE = 'ipms_access';

export interface HeaderCarrier {
  headers: Record<string, string | string[] | undefined>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Header first (mobile and service-to-service callers), then the `ipms_access`
 * cookie (browser). One token format either way.
 *
 * Reads the raw `Cookie` header rather than a parsed `request.cookies`, so it
 * works in a service that has not registered a cookie plugin — the gateway has
 * `@fastify/cookie`, the individual services do not. It must stay a single
 * implementation shared with the guards: if the gateway and a service
 * disagreed about where a token may come from, a token the gateway rejects
 * could still be accepted by a service reached directly.
 */
export function extractToken(request: HeaderCarrier): string | undefined {
  const auth = firstValue(request.headers['authorization']);
  if (auth?.startsWith('Bearer ')) {
    const value = auth.slice(7).trim();
    if (value.length > 0) return value;
  }

  const cookieHeader = firstValue(request.headers['cookie']);
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== ACCESS_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

const b64 = (value: string): string => Buffer.from(value).toString('base64url');

/**
 * Verification is hard-wired to HMAC-SHA256 and never reads `alg` from the
 * header to pick an algorithm. That closes the whole algorithm-confusion
 * family at the root — `alg: none`, or an RS256 header hoping the HMAC secret
 * will be used as a public key — without depending on an allowlist that a
 * later edit could widen. The header is still covered by the signature, so
 * editing it invalidates the token.
 */
function hmac(signingInput: string, secret: string): string {
  return createHmac('sha256', secret).update(signingInput).digest('base64url');
}

export function signToken(
  claims: TokenClaims,
  type: TokenType,
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({
    sub: claims.sub,
    roles: claims.roles,
    permissions: claims.permissions,
    tokenVersion: claims.tokenVersion,
    typ: type,
    iat,
    exp: iat + ttlSeconds,
  }));
  return `${header}.${body}.${hmac(`${header}.${body}`, secret)}`;
}

/**
 * Returns the validated payload, or throws. Never returns a partial result and
 * never reports *why* it failed to a caller that might forward the reason to a
 * client — guards translate any throw into one generic 401.
 *
 * `expectedType` is required rather than defaulted. A default would make the
 * dangerous call (accepting either kind) the shortest one to write, and the
 * refresh-token-as-access-token replay is exactly the bug this parameter
 * exists to prevent.
 */
export function verifyToken(
  token: string,
  secret: string,
  expectedType: TokenType,
  now: number = Date.now(),
): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [header, body, signature] = parts as [string, string, string];

  const expected = hmac(`${header}.${body}`, secret);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first. That comparison leaks only the signature's length, which is fixed
  // by the algorithm and therefore not a secret.
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw new Error('Invalid token signature');
  }

  // Parsed only after the signature check, so untrusted bytes never reach
  // JSON.parse, and validated by schema so a forged-by-the-secret-holder
  // payload still cannot smuggle in a scope list or a malformed subject.
  const raw: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const payload = TokenPayloadSchema.parse(raw);

  if (payload.typ !== expectedType) throw new Error(`Expected a ${expectedType} token`);
  if (payload.exp <= Math.floor(now / 1000)) throw new Error('Token expired');

  return payload;
}
