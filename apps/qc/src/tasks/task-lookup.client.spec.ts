import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskLookupClient } from './task-lookup.client.js';

afterEach(() => { vi.unstubAllGlobals(); });

const client = new TaskLookupClient('http://project:3004');
const TASK = { id: 't-1', projectId: 'p-1', siteId: 's-1', assigneeId: 'u-1', templateId: 'tpl-1', status: 'ONGOING' };

describe('TaskLookupClient.fetch', () => {
  it('forwards the caller’s bearer token to the internal endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(TASK), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client.fetch('t-1', 'Bearer t')).resolves.toEqual({ state: 'found', task: TASK });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://project:3004/api/v1/internal/tasks/t-1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it.each([[404, 'not_found'], [403, 'forbidden'], [401, 'forbidden'], [500, 'unavailable']])('maps %i to %s', async (status, state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(client.fetch('t-1', 'Bearer t')).resolves.toEqual({ state });
  });

  it('is unavailable when the service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(client.fetch('t-1', 'Bearer t')).resolves.toEqual({ state: 'unavailable' });
  });
});
