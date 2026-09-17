import { describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, buildError } from './error.js';

describe('error envelope', () => {
  it('builds a valid envelope', () => {
    const env = buildError('FORBIDDEN', 'Not allowed', 'corr-1');
    expect(ErrorEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(env.error.code).toBe('FORBIDDEN');
    expect(env.error.correlationId).toBe('corr-1');
  });

  it('carries optional details', () => {
    const env = buildError('VALIDATION_FAILED', 'Bad input', 'corr-2', { field: 'email' });
    expect(env.error.details).toEqual({ field: 'email' });
  });

  it('rejects an unknown error code', () => {
    const bad = { error: { code: 'NOPE', message: 'x', correlationId: 'c' } };
    expect(ErrorEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});
