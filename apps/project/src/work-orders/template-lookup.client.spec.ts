import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplateLookupClient } from './template-lookup.client.js';

afterEach(() => { vi.unstubAllGlobals(); });

const client = new TemplateLookupClient('http://qc:3005');
const TEMPLATE = { id: 'tpl-1', code: 'Q6683', name: 'Antenna', category: 'QUALITY', disabled: false, publishedVersion: 1 };

describe('TemplateLookupClient.fetch', () => {
  it('forwards the caller’s bearer token to the internal endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(TEMPLATE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client.fetch('tpl-1', 'Bearer t')).resolves.toEqual({ state: 'found', template: TEMPLATE });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://qc:3005/api/v1/internal/templates/tpl-1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it.each([[404, 'not_found'], [403, 'forbidden'], [401, 'forbidden'], [500, 'unavailable']])('maps %i to %s', async (status, state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(client.fetch('tpl-1', 'Bearer t')).resolves.toEqual({ state });
  });

  it('is unavailable when the service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(client.fetch('tpl-1', 'Bearer t')).resolves.toEqual({ state: 'unavailable' });
  });
});
