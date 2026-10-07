import { beforeEach, describe, expect, it, vi } from 'vitest';

const financeFileUrl = vi.fn();
vi.mock('../../../../lib/media-api', () => ({ financeFileUrl }));

const { GET } = await import('./route');
const ID = '3f2a91c0-1111-2222-3333-444455556666';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
beforeEach(() => financeFileUrl.mockReset());

describe('GET /api/finance/files/:id', () => {
  it('redirects to a freshly signed link for the original, uncached', async () => {
    financeFileUrl.mockResolvedValue({ state: 'ready', data: { signedUrl: 'https://bucket/x.jpg' } });
    const response = await GET(new Request(`http://web/api/finance/files/${ID}`), params(ID));
    expect(financeFileUrl).toHaveBeenCalledWith(ID, 'original');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://bucket/x.jpg');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('asks for the thumbnail when told to', async () => {
    financeFileUrl.mockResolvedValue({ state: 'ready', data: { signedUrl: 'https://bucket/t.webp' } });
    await GET(new Request(`http://web/api/finance/files/${ID}?variant=thumbnail`), params(ID));
    expect(financeFileUrl).toHaveBeenCalledWith(ID, 'thumbnail');
  });

  it('refuses an id that is not a UUID without asking anyone', async () => {
    const response = await GET(new Request('http://web/api/finance/files/x'), params('x'));
    expect(response.status).toBe(404);
    expect(financeFileUrl).not.toHaveBeenCalled();
  });

  it('answers 401 when signed out and passes a refusal on', async () => {
    financeFileUrl.mockResolvedValue({ state: 'unauthenticated' });
    expect((await GET(new Request('http://web/x'), params(ID))).status).toBe(401);
    financeFileUrl.mockResolvedValue({ state: 'forbidden', message: 'nope' });
    expect((await GET(new Request('http://web/x'), params(ID))).status).toBe(403);
  });
});
