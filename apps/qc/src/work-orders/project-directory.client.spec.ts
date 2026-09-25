import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProjectDirectoryClient } from './project-directory.client.js';

afterEach(() => { vi.unstubAllGlobals(); });

const client = new ProjectDirectoryClient('http://project:3004');

describe('ProjectDirectoryClient', () => {
  it('asks for the caller’s scope with their own token', async () => {
    const scope = { global: false, projectIds: ['p-1'], siteIds: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(scope), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client.scope('Bearer t')).resolves.toEqual({ state: 'found', value: scope });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://project:3004/api/v1/internal/scope');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it('posts the site ids it needs resolved', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"project":{},"sites":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await client.siteRefs('p-1', ['s-1'], 'Bearer t');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://project:3004/api/v1/internal/projects/p-1/site-refs');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit)).toMatchObject({ method: 'POST', body: '{"siteIds":["s-1"]}' });
  });

  it.each([[404, 'not_found'], [403, 'forbidden'], [401, 'forbidden'], [500, 'unavailable']])('maps %i to %s', async (status, state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(client.assignable('p-1', 'Bearer t')).resolves.toEqual({ state });
  });

  it('passes project’s own validation message through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"Too many sites"}', { status: 400 })));
    await expect(client.siteRefs('p-1', ['s-1'], 'Bearer t')).rejects.toThrow(BadRequestException);
  });

  it('is unavailable when the service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(client.scope('Bearer t')).resolves.toEqual({ state: 'unavailable' });
  });
});
