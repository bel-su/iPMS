import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: [] });
vi.mock('./api-client', () => ({ authFetch }));
const api = await import('./media-api');
beforeEach(() => { authFetch.mockClear(); });

describe('media-api', () => {
  it('lists a work order’s media', async () => {
    await api.listWorkOrderMedia('wo-1');
    expect(authFetch).toHaveBeenCalledWith('/api/v1/media', { query: { workOrderId: 'wo-1' } });
  });
  it('asks for a view link by variant', async () => {
    await api.mediaUrl('m-1', 'thumbnail');
    expect(authFetch).toHaveBeenCalledWith('/api/v1/media/m-1/url', { query: { variant: 'thumbnail' } });
  });
  it('adds download only when asked', async () => {
    await api.mediaUrl('m-1', 'original', true);
    expect(authFetch).toHaveBeenCalledWith('/api/v1/media/m-1/url', { query: { variant: 'original', download: '1' } });
  });
});
