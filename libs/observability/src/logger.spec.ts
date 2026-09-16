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
});
