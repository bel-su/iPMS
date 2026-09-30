import { beforeEach, describe, expect, it, vi } from 'vitest';

const mediaUrl = vi.fn();
vi.mock('../../lib/media-api', () => ({ mediaUrl }));
const { GET } = await import('./[id]/[variant]/route');

const call = (id: string, variant: string) => GET(new Request('http://web/api/media'), { params: Promise.resolve({ id, variant }) });

describe('GET /api/media/:id/:variant', () => {
  beforeEach(() => mediaUrl.mockReset());

  it('redirects to a freshly signed link and forbids caching', async () => {
    mediaUrl.mockResolvedValue({ state: 'ready', data: { signedUrl: 'https://r2.example/x?X-Amz-Signature=s', expiresAt: '' } });
    const response = await call('0192f7a0-0000-7000-8000-000000000001', 'thumbnail');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://r2.example/x?X-Amz-Signature=s');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mediaUrl).toHaveBeenCalledWith('0192f7a0-0000-7000-8000-000000000001', 'thumbnail');
  });

  it('refuses an unknown variant or a malformed id without calling media', async () => {
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'raw')).status).toBe(404);
    expect((await call('../etc', 'original')).status).toBe(404);
    expect(mediaUrl).not.toHaveBeenCalled();
  });

  it('passes through sign-in, permission and availability failures', async () => {
    mediaUrl.mockResolvedValue({ state: 'unauthenticated' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(401);
    mediaUrl.mockResolvedValue({ state: 'forbidden', message: 'no' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(403);
    mediaUrl.mockResolvedValue({ state: 'unavailable', status: 409, message: 'not ready' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(409);
    mediaUrl.mockResolvedValue({ state: 'unavailable', status: null, message: 'down' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(503);
  });
});
