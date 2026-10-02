import { describe, expect, it } from 'vitest';
import { respond } from './respond';

describe('respond', () => {
  it('passes data through, uncached', async () => {
    const res = respond({ state: 'ready', data: { count: 3 } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ count: 3 });
  });

  it('answers 204 for an empty success', () => {
    expect(respond({ state: 'ready', data: undefined }).status).toBe(204);
  });

  it('answers 401 when signed out and 403 when refused', () => {
    expect(respond({ state: 'unauthenticated' }).status).toBe(401);
    expect(respond({ state: 'forbidden', message: 'no' }).status).toBe(403);
  });

  it('keeps a client error status and turns an upstream failure into 503', () => {
    expect(respond({ state: 'unavailable', status: 404, message: 'gone' }).status).toBe(404);
    expect(respond({ state: 'unavailable', status: 500, message: 'boom' }).status).toBe(503);
    expect(respond({ state: 'unavailable', status: null, message: 'down' }).status).toBe(503);
  });
});
