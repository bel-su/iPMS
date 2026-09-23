import 'server-only';
import { cookies } from 'next/headers';
import type { ErrorCode } from '@ipms/contracts';
import { ACCESS_COOKIE, apiBaseUrl } from './session';

/**
 * The one way this app talks to the platform.
 *
 * Every call goes to the gateway, never to a service directly, so the
 * allowlist in `apps/gateway/src/proxy/routes.ts` stays the single description
 * of what is reachable from outside. The access token travels as a bearer
 * header; each service re-verifies it, and the gateway adds nothing the
 * services are asked to trust.
 *
 * Renewal is not done here. An expired access token is renewed in
 * `middleware.ts` before the render begins, because a React Server Component
 * cannot write a cookie — the pair has to be stored somewhere the response is
 * still open. By the time `authFetch` runs, the token it reads is either live
 * or genuinely gone.
 */

export type ApiResult<T> =
  | { state: 'ready'; data: T }
  /** No token, or the gateway refused the one we hold. The caller should send the user to sign in. */
  | { state: 'unauthenticated' }
  /** Signed in, but this user may not do this. Sending them to sign in again would not help. */
  | { state: 'forbidden'; message: string; correlationId?: string }
  /** Anything else: unreachable, 5xx, a rejected request body, an undecodable answer. */
  | { state: 'unavailable'; status: number | null; message: string; code?: ErrorCode; correlationId?: string; details?: Record<string, string> };

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialized as the JSON request body; sets the content type. */
  json?: unknown;
  /** Appended as a query string; undefined values are dropped. */
  query?: Record<string, string | undefined>;
  /**
   * Sent as the request body verbatim, for uploads. The content type is left
   * unset on purpose: `fetch` derives it from a `FormData` body along with the
   * multipart boundary, and setting it by hand omits the boundary and makes
   * the upload unparseable upstream.
   */
  body?: BodyInit;
}

const UNREACHABLE = 'The iPMS API could not be reached.';
const UNEXPECTED = 'The iPMS API returned an unexpected error.';

function buildQuery(query: ApiRequest['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * Pulls what can be trusted out of a failed response, and nothing else.
 *
 * Only the fields of the platform's own error envelope are kept. Returning the
 * raw body instead would hand a page whatever an upstream produced — a stack
 * trace, a proxy's HTML error page — as something renderable.
 */
async function describeFailure(response: Response): Promise<{ message: string; code?: ErrorCode; correlationId?: string; details?: Record<string, string> }> {
  try {
    const payload: unknown = await response.json();
    const envelope = (payload as { error?: Record<string, unknown> } | null)?.error;
    if (envelope && typeof envelope['message'] === 'string' && envelope['message'].length > 0) {
      const rawDetails = envelope['details'];
      // Only strings survive: a field path mapped to its message is all a form can render.
      const details = rawDetails && typeof rawDetails === 'object'
        ? Object.fromEntries(Object.entries(rawDetails as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : undefined;
      return {
        message: envelope['message'],
        ...(typeof envelope['code'] === 'string' ? { code: envelope['code'] as ErrorCode } : {}),
        ...(typeof envelope['correlationId'] === 'string' ? { correlationId: envelope['correlationId'] } : {}),
        ...(details && Object.keys(details).length > 0 ? { details } : {}),
      };
    }
  } catch {
    // Not JSON, or not the envelope — fall through to the generic message.
  }
  return { message: UNEXPECTED };
}

export async function authFetch<T>(path: string, request: ApiRequest = {}): Promise<ApiResult<T>> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return { state: 'unauthenticated' };

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}${buildQuery(request.query)}`, {
      method: request.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(request.json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(request.json !== undefined
        ? { body: JSON.stringify(request.json) }
        : request.body !== undefined
          ? { body: request.body }
          : {}),
      cache: 'no-store',
    });
  } catch {
    return { state: 'unavailable', status: null, message: UNREACHABLE };
  }

  if (response.status === 401) return { state: 'unauthenticated' };
  if (response.status === 403) {
    const { message, correlationId } = await describeFailure(response);
    return { state: 'forbidden', message, ...(correlationId === undefined ? {} : { correlationId }) };
  }
  if (!response.ok) {
    return { state: 'unavailable', status: response.status, ...(await describeFailure(response)) };
  }

  // 204 and 205 carry no body, and JSON.parse('') throws — a successful write
  // must not be reported as a broken API.
  try {
    const text = await response.text();
    return { state: 'ready', data: (text ? JSON.parse(text) : undefined) as T };
  } catch {
    return { state: 'unavailable', status: response.status, message: UNEXPECTED };
  }
}
