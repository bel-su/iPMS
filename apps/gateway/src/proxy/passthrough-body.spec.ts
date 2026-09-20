import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerPassthroughBodyParser } from './passthrough-body.js';

let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

/** A route that only reports that it was reached, so a 415 is unmistakable. */
async function build(withParser: boolean): Promise<FastifyInstance> {
  app = Fastify();
  if (withParser) registerPassthroughBodyParser(app);
  app.post('/*', async () => ({ reached: true }));
  await app.ready();
  return app;
}

const MULTIPART =
  '------x\r\nContent-Disposition: form-data; name="file"; filename="s.xlsx"\r\n\r\nPK\r\n------x--\r\n';

describe('registerPassthroughBodyParser', () => {
  // The bug this exists for: an upload died at the edge with 415 while the
  // same request succeeded against the service directly.
  it('lets a multipart upload reach the route instead of 415', async () => {
    const server = await build(true);
    const response = await server.inject({
      method: 'POST', url: '/api/v1/projects/p/sites/import/preview',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      payload: MULTIPART,
    });
    expect(response.statusCode).toBe(200);
  });

  it('pins the failure it fixes: without it, Fastify refuses the same request', async () => {
    const server = await build(false);
    const response = await server.inject({
      method: 'POST', url: '/api/v1/projects/p/sites/import/preview',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      payload: MULTIPART,
    });
    expect(response.statusCode).toBe(415);
  });

  // The catch-all must not displace the built-in JSON parser, or every
  // ordinary API call through the gateway would start arriving unparsed.
  it('leaves JSON to Fastify’s own parser', async () => {
    const server = await build(true);
    const response = await server.inject({
      method: 'POST', url: '/api/v1/projects',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'ALPHA' }),
    });
    expect(response.statusCode).toBe(200);
  });

  it('passes an octet-stream body through as well', async () => {
    const server = await build(true);
    const response = await server.inject({
      method: 'POST', url: '/api/v1/media',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    });
    expect(response.statusCode).toBe(200);
  });
});
