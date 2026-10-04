import { afterEach, describe, expect, it, vi } from 'vitest';
import { QcClient } from './qc.client.js';

const ID = '0192f7a0-0000-7000-8000-000000000001';
const respond = (status: number, body: unknown = {}) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.restoreAllMocks());

describe('QcClient.workOrder', () => {
  it('reads project, site and status from qc, forwarding the caller token', async () => {
    const fetchSpy = respond(200, { id: ID, projectId: 'p', siteId: 's', status: 'ONGOING', site: { siteCode: 'KOS121' } });
    const lookup = await new QcClient('http://qc:3005').workOrder(ID, 'Bearer t');
    expect(lookup).toEqual({ state: 'found', value: { id: ID, projectId: 'p', siteId: 's', siteCode: 'KOS121', status: 'ONGOING' } });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`http://qc:3005/api/v1/work-orders/${ID}`);
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it.each([[404, 'not_found'], [403, 'forbidden'], [502, 'unavailable']])('maps %i to %s', async (status, state) => {
    respond(status);
    expect((await new QcClient('http://qc:3005').workOrder(ID, 'Bearer t')).state).toBe(state);
  });

  it('treats a network failure as unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await new QcClient('http://qc:3005').workOrder(ID, 'Bearer t')).state).toBe('unavailable');
  });
});
