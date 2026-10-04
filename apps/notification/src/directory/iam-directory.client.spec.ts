import { describe, expect, it, vi } from 'vitest';
import { IamDirectoryClient } from './iam-directory.client.js';

function client(response: Response | Error) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: new IamDirectoryClient('http://iam:3001', 'k-123', 3000, fetchImpl as never), fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('IamDirectoryClient.holders', () => {
  it('posts the permission and project with the service key and returns the ids', async () => {
    const { client: c, fetchImpl } = client(ok({ userIds: ['u-1', 'u-2'] }));
    expect(await c.holders('qc_review.approve', 'p-1')).toEqual(['u-1', 'u-2']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://iam:3001/api/v1/internal/authz/holders');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-internal-key': 'k-123', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ permission: 'qc_review.approve', projectId: 'p-1' });
  });

  it('sends the site id when given', async () => {
    const { client: c, fetchImpl } = client(ok({ userIds: [] }));
    await c.holders('qc_review.approve', 'p-1', 'si-1');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ permission: 'qc_review.approve', projectId: 'p-1', siteId: 'si-1' });
  });

  it('throws on a non-2xx answer so the event is redelivered', async () => {
    await expect(client(new Response('', { status: 503 })).client.holders('x', 'p')).rejects.toThrow('503');
  });

  it('throws when iam cannot be reached', async () => {
    await expect(client(new Error('connect ECONNREFUSED')).client.holders('x', 'p')).rejects.toThrow('ECONNREFUSED');
  });

  it('throws on an answer that is not the agreed shape', async () => {
    await expect(client(ok({ users: [] })).client.holders('x', 'p')).rejects.toThrow();
  });
});
