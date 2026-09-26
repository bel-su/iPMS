const BASE = process.env['E2E_GATEWAY_URL'] ?? 'http://localhost:3000';

/**
 * The password iam-migrate seeds all four demo accounts with. Like BASE, the
 * default is the Compose stack's own value (IAM_DEMO_PASSWORD in
 * docker/env/iam.env), so the suite runs against `docker compose up` with no
 * configuration. Read it from here rather than hardcoding one per spec: a
 * spec that disagrees with the seed fails every test at login.
 */
export const DEMO_PASSWORD = process.env['IAM_DEMO_PASSWORD'] ?? 'P@ssw0rd1234';

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<ApiResponse<T>> {
  // Only declare a JSON content-type when there is actually a JSON body to
  // describe. Fastify rejects an empty body carrying `application/json` with a
  // 400 before the route handler runs, so sending the header unconditionally
  // made every bodyless POST/DELETE here assert against that 400 rather than
  // against the endpoint's real response.
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

export async function waitForReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health/ready`);
      if (res.ok) return;
    } catch {
      // stack still starting
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Gateway not ready within ${timeoutMs}ms`);
}
