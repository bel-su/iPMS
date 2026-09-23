import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const { proxyDownload } = await import('./download');

beforeEach(() => { cookieStore.get.mockReset(); vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('proxyDownload', () => {
  it('answers 401 without a session and never calls the gateway', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxyDownload('/api/v1/qc/templates/import/blank', 'x.xlsx', 'nope');
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams the file with the upstream filename', async () => {
    cookieStore.get.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', {
      status: 200, headers: { 'content-disposition': 'attachment; filename="AI-v2.xlsx"' },
    })));
    const response = await proxyDownload('/api/v1/qc/templates/t/versions/2/export', 'x.xlsx', 'nope');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="AI-v2.xlsx"');
    expect(await response.text()).toBe('bytes');
  });

  it('keeps a 403 a 403, with the given message', async () => {
    cookieStore.get.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const response = await proxyDownload('/api/v1/x', 'x.xlsx', 'You cannot view templates.');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: 'You cannot view templates.' });
  });
});
