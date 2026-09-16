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
});
