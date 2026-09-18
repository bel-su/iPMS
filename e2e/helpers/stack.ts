const BASE = process.env['E2E_GATEWAY_URL'] ?? 'http://localhost:3000';

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
