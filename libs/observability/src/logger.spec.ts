import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from './logger.js';
import { runWithCorrelation } from './correlation.js';

function capture(): { sink: Writable; lines: string[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  return { sink, lines };
}

describe('createLogger', () => {
  it('emits the service name on every line', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info('hello');
    expect(JSON.parse(lines[0]!).service).toBe('iam');
  });

  it('injects the ambient correlation id', () => {
    const { sink, lines } = capture();
    const log = createLogger('iam', sink);
    runWithCorrelation('corr-9', () => log.info('hello'));
    expect(JSON.parse(lines[0]!).correlationId).toBe('corr-9');
  });

  it('redacts secret-bearing fields', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info({ password: 'hunter2', token: 'abc' }, 'login');
    const out = JSON.parse(lines[0]!);
    expect(out.password).toBe('[Redacted]');
    expect(out.token).toBe('[Redacted]');
  });

  it('redacts a secret nested two levels deep', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info({ user: { password: 'hunter2' } }, 'login');
    const out = JSON.parse(lines[0]!);
    expect(out.user.password).toBe('[Redacted]');
  });

  it('redacts a secret nested three levels deep', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info(
      { req: { headers: { authorization: 'Bearer xyz' } } },
      'incoming request',
    );
    const out = JSON.parse(lines[0]!);
    expect(out.req.headers.authorization).toBe('[Redacted]');
  });

  it('does not redact non-secret nested fields', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info({ user: { id: 'u-1', password: 'hunter2' } }, 'login');
    const out = JSON.parse(lines[0]!);
    expect(out.user.id).toBe('u-1');
    expect(out.user.password).toBe('[Redacted]');
  });

  it('redacts newly added secret key names', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info(
      { apiKey: 'ak-live-123', req: { headers: { cookie: 'sid=abc123' } } },
      'call',
    );
    const out = JSON.parse(lines[0]!);
    expect(out.apiKey).toBe('[Redacted]');
    expect(out.req.headers.cookie).toBe('[Redacted]');
  });

  it('redacts a secret nested four levels deep', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info(
      { a: { b: { c: { password: 'deep-secret-4' } } } },
      'deep',
    );
    const out = JSON.parse(lines[0]!);
    expect(out.a.b.c.password).toBe('[Redacted]');
  });

  it('redacts a secret nested six levels deep', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info(
      { a2: { b: { c: { d: { e: { token: 'deep-secret-6' } } } } } },
      'deep',
    );
    const out = JSON.parse(lines[0]!);
    expect(out.a2.b.c.d.e.token).toBe('[Redacted]');
  });

  it('redacts secrets regardless of key casing', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info(
      { Authorization: 'Bearer xyz', AUTHORIZATION: 'Bearer xyz', authorization: 'Bearer xyz' },
      'headers',
    );
    const out = JSON.parse(lines[0]!);
    expect(out.Authorization).toBe('[Redacted]');
    expect(out.AUTHORIZATION).toBe('[Redacted]');
    expect(out.authorization).toBe('[Redacted]');
  });

  it('redacts a secret inside an array of objects', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info(
      { users: [{ id: 'u-1', password: 'hunter2' }, { id: 'u-2', password: 'hunter3' }] },
      'bulk');
    const out = JSON.parse(lines[0]!);
    expect(out.users[0].id).toBe('u-1');
    expect(out.users[0].password).toBe('[Redacted]');
    expect(out.users[1].id).toBe('u-2');
    expect(out.users[1].password).toBe('[Redacted]');
  });

  it('does not throw or hang on a circular reference', () => {
    const { sink, lines } = capture();
    const obj: Record<string, unknown> = { name: 'req', password: 'hunter2' };
    obj['self'] = obj;
    expect(() => createLogger('iam', sink).info({ req: obj }, 'circular')).not.toThrow();
    const out = JSON.parse(lines[0]!);
    expect(out.req.name).toBe('req');
    expect(out.req.password).toBe('[Redacted]');
    expect(out.req.self).toBe('[Circular]');
  });

  it('keeps an Error value intact with its message', () => {
    const { sink, lines } = capture();
    const err = new Error('boom');
    createLogger('iam', sink).info({ err }, 'failure');
    const out = JSON.parse(lines[0]!);
    expect(out.err.message).toBe('boom');
    expect(typeof out.err.stack).toBe('string');
  });

  it('does not mutate the caller-supplied object', () => {
    const { sink } = capture();
    const original = { user: { password: 'hunter2', id: 'u-1' } };
    const snapshotBefore = JSON.parse(JSON.stringify(original));
    createLogger('iam', sink).info(original, 'login');
    expect(original).toEqual(snapshotBefore);
    expect(original.user.password).toBe('hunter2');
  });

  it('passes non-secret fields through unchanged at every depth', () => {
    const { sink, lines } = capture();
    createLogger('iam', sink).info(
      {
        requestId: 'r-1',
        meta: { count: 3, nested: { flag: true, deeper: { label: 'ok' } } },
      },
      'ok',
    );
    const out = JSON.parse(lines[0]!);
    expect(out.requestId).toBe('r-1');
    expect(out.meta.count).toBe(3);
    expect(out.meta.nested.flag).toBe(true);
    expect(out.meta.nested.deeper.label).toBe('ok');
  });
});
