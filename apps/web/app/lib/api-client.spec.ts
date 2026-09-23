import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const { authFetch } = await import('./api-client');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function signedIn(): void {
  cookieStore.get.mockImplementation((name: string) => (name === 'ipms_access_token' ? { value: 'access.jwt' } : undefined));
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  cookieStore.get.mockReset();
  signedIn();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('authFetch — the request it builds', () => {
  it('calls the gateway, never a service directly', async () => {
    vi.stubEnv('IPMS_API_BASE_URL', 'http://gateway:3000');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/v1/projects');

    expect(fetchMock.mock.calls[0]![0]).toBe('http://gateway:3000/api/v1/projects');
  });

  it('presents the access token as a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/v1/projects');

    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe('Bearer access.jwt');
  });

  it('never caches: dashboards must not serve a previous request’s data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/v1/projects');

    expect(fetchMock.mock.calls[0]![1].cache).toBe('no-store');
  });

  it('sends a JSON body with its content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/v1/projects', { method: 'POST', json: { code: 'ALPHA' } });

    const init = fetchMock.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'ALPHA' });
  });

  it('sends no content type on a body-less request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/v1/projects');

    expect(fetchMock.mock.calls[0]![1].headers['content-type']).toBeUndefined();
  });

  it('sends a raw body without forcing a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.set('file', new Blob(['x']), 'sites.xlsx');
    await authFetch('/api/v1/x', { method: 'POST', body: form });

    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBe(form);
    // Set explicitly, the multipart boundary would be missing and the upload
    // would be unparseable upstream — fetch must derive it from the FormData.
    expect(init.headers['content-type']).toBeUndefined();
  });
});

describe('authFetch — outcomes', () => {
  it('returns the decoded body when the gateway answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { activeProjectCount: 2 })));
    expect(await authFetch<{ activeProjectCount: number }>('/api/v1/dashboard'))
      .toEqual({ state: 'ready', data: { activeProjectCount: 2 } });
  });

  // 204 is a legitimate success, and JSON.parse('') throws. Treating it as a
  // failure would report a successful write as a broken API.
  it('treats an empty success body as ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await authFetch('/api/v1/tasks/x/assign', { method: 'POST' }))
      .toEqual({ state: 'ready', data: undefined });
  });

  it('asks for a sign-in instead of calling the gateway when no token is held', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await authFetch('/api/v1/projects')).toEqual({ state: 'unauthenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 401 to unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } })));
    expect(await authFetch('/api/v1/projects')).toEqual({ state: 'unauthenticated' });
  });

  // 403 is a real answer about this user: signed in, but not permitted. Folding
  // it into 'unauthenticated' would bounce them to a login page that cannot
  // help, in a loop.
  it('distinguishes forbidden from unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Permission project.create is required', correlationId: 'cid-1' } }),
    ));

    expect(await authFetch('/api/v1/projects', { method: 'POST', json: {} })).toEqual({
      state: 'forbidden', message: 'Permission project.create is required', correlationId: 'cid-1',
    });
  });

  it('carries the error envelope’s message, code and correlation id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', correlationId: 'cid-2' } }),
    ));

    expect(await authFetch('/api/v1/projects', { method: 'POST', json: {} })).toEqual({
      state: 'unavailable', status: 422, code: 'VALIDATION_FAILED',
      message: 'Request validation failed', correlationId: 'cid-2',
    });
  });

  // The previous shape returned `await response.text()` as `error`, which puts
  // whatever an upstream produced — a stack trace, an HTML error page — into a
  // value a page could render. Only the envelope's own fields survive.
  it('does not pass a non-envelope error body through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html>nginx: upstream connect error at /var/secret</html>', { status: 502 }),
    ));

    const result = await authFetch('/api/v1/projects');
    expect(result).toEqual({ state: 'unavailable', status: 502, message: 'The iPMS API returned an unexpected error.' });
    expect(JSON.stringify(result)).not.toContain('/var/secret');
  });

  it('reports an unreachable gateway with no status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await authFetch('/api/v1/projects')).toEqual({
      state: 'unavailable', status: null, message: 'The iPMS API could not be reached.',
    });
  });

  // A 200 whose body is not JSON is a broken upstream, not data.
  it('reports an undecodable success body as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const result = await authFetch('/api/v1/projects');
    expect(result.state).toBe('unavailable');
  });
});

describe('authFetch — validation details', () => {
  it('keeps the string-valued details of a validation failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, {
      error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', correlationId: 'c-1', details: { 'sections.0.title': 'Required', odd: 5 } },
    })));
    const result = await authFetch('/api/v1/qc/templates/t/draft');
    expect(result).toMatchObject({ state: 'unavailable', status: 422, details: { 'sections.0.title': 'Required' } });
    expect((result as { details: Record<string, unknown> }).details).not.toHaveProperty('odd');
  });
});
