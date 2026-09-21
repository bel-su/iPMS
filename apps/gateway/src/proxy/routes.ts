export interface Upstream {
  prefix: string;
  service: string;
  host: string;
  port: number;
}

/**
 * Where each service is reachable. The defaults are the Compose service names,
 * so the stack needs no configuration; the environment overrides exist so the
 * gateway can also be run against services on localhost, which is what makes
 * it bootable and testable outside Compose.
 */
function upstreamHost(service: string, fallbackHost: string): string {
  return process.env[`${service.toUpperCase()}_HOST`] ?? fallbackHost;
}

function upstreamPort(service: string, fallbackPort: number): number {
  const raw = process.env[`${service.toUpperCase()}_PORT`];
  if (raw === undefined) return fallbackPort;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackPort;
}

const IAM = { host: upstreamHost('iam', 'iam'), port: upstreamPort('iam', 3001) };
const AUDIT = { host: upstreamHost('audit', 'audit'), port: upstreamPort('audit', 3003) };
const PROJECT = { host: upstreamHost('project', 'project'), port: upstreamPort('project', 3004) };
const QC = { host: upstreamHost('qc', 'qc'), port: upstreamPort('qc', 3005) };
const MEDIA = { host: upstreamHost('media', 'media'), port: upstreamPort('media', 3006) };

/**
 * Only paths listed here are reachable. Anything else 404s at the edge, which
 * is what keeps `/internal/*` endpoints private to service-to-service calls.
 */
export const ROUTES: Upstream[] = [
  { prefix: '/api/v1/auth', service: 'iam', ...IAM },
  { prefix: '/api/v1/roles', service: 'iam', ...IAM },
  { prefix: '/api/v1/permissions', service: 'iam', ...IAM },
  { prefix: '/api/v1/users', service: 'iam', ...IAM },
  { prefix: '/api/v1/access', service: 'iam', ...IAM },
  { prefix: '/api/v1/audit', service: 'audit', ...AUDIT },
  { prefix: '/api/v1/dashboard', service: 'project', ...PROJECT },
  { prefix: '/api/v1/projects', service: 'project', ...PROJECT },
  // Sub-resources are addressed by their own id, so each needs its own prefix.
  // Project-level milestones are '/api/v1/milestones'; '/api/v1/site-milestones'
  // is reserved for per-site milestone instances, which are a different entity.
  { prefix: '/api/v1/sites', service: 'project', ...PROJECT },
  { prefix: '/api/v1/task-types', service: 'project', ...PROJECT },
  { prefix: '/api/v1/milestones', service: 'project', ...PROJECT },
  { prefix: '/api/v1/tasks', service: 'project', ...PROJECT },
  { prefix: '/api/v1/qc', service: 'qc', ...QC },
  { prefix: '/api/v1/media', service: 'media', ...MEDIA },
];

/**
 * Every path segment this platform serves is either a fixed name or a UUID, so
 * a legitimate request never needs a percent-escape in its *path*. Requiring
 * that outright is what makes the traversal check simple enough to trust.
 *
 * The alternative — decode, then look for `..` — has to decide how many rounds
 * of decoding to do. One round leaves `%252e%252e%252f` (which decodes to
 * `%2e%2e%2f`, and decodes again to `../`) looking harmless; any fixed number
 * of rounds can be beaten by one more layer. Refusing `%` in the path removes
 * the question rather than answering it.
 *
 * Query strings are exempt: they legitimately carry encoded values, and they
 * are never used to choose an upstream.
 */
const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]*$/;

/**
 * Splits a raw request target into its path and its query string, and cleans
 * up the path without decoding it.
 *
 * Both halves matter. The path must be cleaned *before* it is matched, or
 * `/api/v1/audit/../../internal/secrets` matches the audit prefix and is then
 * resolved by the upstream to a path the route table never allowed. And the
 * query string must be split off before matching, or a legitimate
 * `/api/v1/auth?next=x` matches no prefix — it is neither equal to
 * `/api/v1/auth` nor prefixed by `/api/v1/auth/` — and 404s.
 *
 * The returned path is the caller's own, minus redundant separators. It is
 * deliberately not percent-decoded: forwarding a decoded path would strip
 * escaping the caller meant to keep, and would hand the upstream a string it
 * decodes a second time.
 */
export function normalizeTarget(rawUrl: string): { path: string; query: string } | undefined {
  const queryAt = rawUrl.indexOf('?');
  const rawPath = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
  const query = queryAt === -1 ? '' : rawUrl.slice(queryAt);

  if (!rawPath.startsWith('/')) return undefined;
  // Covers backslash (a separator on some upstream stacks but not in a URL),
  // null bytes, and every percent-escape — see SAFE_PATH.
  if (!SAFE_PATH.test(rawPath)) return undefined;

  const segments: string[] = [];
  for (const segment of rawPath.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // Refuse rather than pop. Popping would silently rewrite the caller's
      // path into a different, allowed one; refusing makes the attempt visible.
      return undefined;
    }
    segments.push(segment);
  }

  return { path: `/${segments.join('/')}`, query };
}

export function resolveUpstream(rawUrl: string): Upstream | undefined {
  const target = normalizeTarget(rawUrl);
  if (!target) return undefined;

  // Checked against the normalized path, so no encoding or traversal spelling
  // reaches an internal route.
  if (target.path === '/internal' || target.path.includes('/internal/')) return undefined;

  // Longest prefix wins, so a more specific route added later cannot be
  // shadowed by a shorter one declared above it.
  return ROUTES
    .filter((r) => target.path === r.prefix || target.path.startsWith(`${r.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

/**
 * The only proxied paths reachable without a token.
 *
 * The gateway's proxy is a catch-all behind `JwtGuard`, so without this list
 * there is no way to ever obtain a token: the login request itself is refused
 * with 401. `@Public()` cannot express it, because one handler serves every
 * upstream path.
 *
 * Kept deliberately tiny and matched exactly, never by prefix. A prefix rule
 * on `/api/v1/auth` would expose `logout` and `me`, which must stay
 * authenticated — `logout` revokes a session and `me` discloses the caller's
 * roles and permissions. Refresh is here because it is redeemed precisely when
 * the access token has expired; it authenticates itself by presenting a valid
 * refresh token in its body, which iam verifies.
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
]);

/** True when the request may proceed to its upstream with no access token. */
export function isPublicPath(rawUrl: string): boolean {
  const target = normalizeTarget(rawUrl);
  return target !== undefined && PUBLIC_PATHS.has(target.path);
}
