import { describe, expect, it } from 'vitest';
import { createEnvelope } from './envelope.js';
import { runWithCorrelation } from '@ipms/observability';

describe('createEnvelope', () => {
  it('stamps eventId, subject, and version', () => {
    const env = createEnvelope('iam.scope.granted', { userId: 'u1' }, { correlationId: 'c1' });
    expect(env.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.subject).toBe('iam.scope.granted');
    expect(env.version).toBe(1);
  });

  it('uses an ISO-8601 UTC occurredAt', () => {
    const env = createEnvelope('iam.scope.granted', {}, { correlationId: 'c1' });
    expect(env.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('inherits the ambient correlation id when none is passed', () => {
    const env = runWithCorrelation('ambient-7', () => createEnvelope('iam.scope.granted', {}));
    expect(env.correlationId).toBe('ambient-7');
  });

  it('generates a correlation id when there is no ambient context', () => {
    expect(createEnvelope('iam.scope.granted', {}).correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives distinct event ids to identical payloads', () => {
    const a = createEnvelope('x.y.z', { same: true });
    const b = createEnvelope('x.y.z', { same: true });
    expect(a.eventId).not.toBe(b.eventId);
  });
});
