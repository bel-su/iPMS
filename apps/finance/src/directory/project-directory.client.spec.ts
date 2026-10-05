import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDirectoryClient, required } from './project-directory.client.js';

const respond = (status: number, body: unknown = {}) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
const client = () => new ProjectDirectoryClient('http://project:3004');
afterEach(() => vi.unstubAllGlobals());

describe('ProjectDirectoryClient', () => {
  it('forwards the caller\'s bearer token to project\'s scope endpoint', async () => {
    const fetchMock = respond(200, { global: false, projectIds: ['p1'], siteIds: [] });
    vi.stubGlobal('fetch', fetchMock);
    expect(await client().scope('Bearer abc')).toEqual({ state: 'found', value: { global: false, projectIds: ['p1'], siteIds: [] } });
    expect(fetchMock).toHaveBeenCalledWith('http://project:3004/api/v1/internal/scope', expect.objectContaining({ headers: { authorization: 'Bearer abc' } }));
  });

  it('reduces a project to the facts a request snapshots', async () => {
    vi.stubGlobal('fetch', respond(200, { id: 'p1', code: 'KOS', name: 'Koshi', status: 'ONGOING', extra: 'ignored' }));
    expect(await client().project('p1', 'Bearer abc')).toEqual({ state: 'found', value: { id: 'p1', code: 'KOS', name: 'Koshi' } });
  });

  it('maps 404, 401/403 and server errors to distinct states', async () => {
    vi.stubGlobal('fetch', respond(404)); expect(await client().project('p', 'b')).toEqual({ state: 'not_found' });
    vi.stubGlobal('fetch', respond(403)); expect(await client().project('p', 'b')).toEqual({ state: 'forbidden' });
    vi.stubGlobal('fetch', respond(500)); expect(await client().project('p', 'b')).toEqual({ state: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down'))); expect(await client().scope('b')).toEqual({ state: 'unavailable' });
  });

  it('turns a lookup into a value or the matching HTTP error', () => {
    expect(required({ state: 'found', value: 5 }, 'Thing')).toBe(5);
    expect(() => required({ state: 'not_found' }, 'Project')).toThrow(/Project not found/);
    expect(() => required({ state: 'forbidden' }, 'Project')).toThrow(/cannot view this project/);
    expect(() => required({ state: 'unavailable' }, 'Project')).toThrow(/could not be reached/);
  });
});
