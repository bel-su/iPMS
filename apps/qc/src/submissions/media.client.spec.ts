import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MediaClient } from './media.client.js';

const body = { workOrderId: 'w', siteId: 's', mediaIds: ['m'] };
const respond = (status: number, json: unknown = {}) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(json), { status }));
afterEach(() => vi.restoreAllMocks());

describe('MediaClient', () => {
  const client = new MediaClient('http://media:3006');

  it('posts the check with the caller token and returns the results', async () => {
    const fetch = respond(200, [{ id: 'm', kind: 'PHOTO', usable: true }]);
    expect(await client.check(body, 'Bearer t')).toEqual([{ id: 'm', kind: 'PHOTO', usable: true }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://media:3006/api/v1/media/internal/check');
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' } });
    expect(JSON.parse(String(init!.body))).toEqual(body);
  });

  it('maps attach 200 → attached and 409 → refused', async () => {
    respond(200, []);
    expect(await client.attach({ ...body, submissionId: 'x' }, 'Bearer t')).toBe('attached');
    vi.restoreAllMocks();
    respond(409);
    expect(await client.attach({ ...body, submissionId: 'x' }, 'Bearer t')).toBe('refused');
  });

  it('turns 403 into Forbidden and anything else into 503', async () => {
    respond(403);
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ForbiddenException);
    vi.restoreAllMocks();
    respond(500);
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.attach({ ...body, submissionId: 'x' }, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
