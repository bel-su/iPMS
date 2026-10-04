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

  const attachBody = { ...body, submissionId: 'x' };

  it('releases the body of an error reply', async () => {
    for (const status of [409, 403, 500]) {
      const reply = new Response(JSON.stringify({ error: 'x' }), { status });
      const cancel = vi.spyOn(reply.body!, 'cancel');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply);
      await client.attach(attachBody, 'Bearer t').catch(() => {});
      expect(cancel).toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('turns 401 into Forbidden', async () => {
    respond(401);
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('check: a 200 whose body is not JSON is a 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>oops', { status: 200 }));
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('check: a 200 whose JSON is not an array is a 503', async () => {
    respond(200, { error: 'nope' });
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('check: a 409 (never expected from a read-only call) is a 503', async () => {
    respond(409);
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('attach: 500 is a 503 and 403 is Forbidden', async () => {
    respond(500);
    await expect(client.attach(attachBody, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
    vi.restoreAllMocks();
    respond(403);
    await expect(client.attach(attachBody, 'Bearer t')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a timeout while waiting for headers is a 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a body that stalls past the timeout is a 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const stalled = new ReadableStream({
        start(controller) {
          init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason));
        },
      });
      return new Response(stalled, { status: 200 });
    });
    await expect(new MediaClient('http://media:3006', 20).check(body, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
