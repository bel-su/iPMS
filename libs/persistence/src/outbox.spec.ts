import { describe, expect, it } from 'vitest';
import { buildOutboxRecord, OUTBOX_MODEL_SQL } from './outbox.js';

describe('buildOutboxRecord', () => {
  it('assigns a uuid id usable as the event id', () => {
    const rec = buildOutboxRecord('iam.scope.granted', { userId: 'u1' }, 'corr-1');
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('records the subject and payload verbatim', () => {
    const rec = buildOutboxRecord('iam.scope.granted', { userId: 'u1', projectId: 'p1' }, 'corr-1');
    expect(rec.subject).toBe('iam.scope.granted');
    expect(rec.payload).toEqual({ userId: 'u1', projectId: 'p1' });
  });

  it('carries the correlation id and optional actor', () => {
    const rec = buildOutboxRecord('iam.role.assigned', {}, 'corr-2', 'actor-9');
    expect(rec.correlationId).toBe('corr-2');
    expect(rec.actorId).toBe('actor-9');
  });

  it('starts unpublished', () => {
    expect(buildOutboxRecord('x.y.z', {}, 'c').publishedAt).toBeNull();
  });

  it('exposes an index on publishedAt so the drainer scans only pending rows', () => {
    expect(OUTBOX_MODEL_SQL).toContain('@@index([publishedAt, createdAt])');
  });
});
