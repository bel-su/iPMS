import { describe, expect, it, vi } from 'vitest';
import { SUBJECTS } from '@ipms/events';
import { asJson, recordAudit } from './audit.js';

function fakeTx() {
  const create = vi.fn().mockResolvedValue({});
  return { create, tx: { outboxEvent: { create } } };
}

describe('recordAudit', () => {
  it('writes an outbox row on the audit subject', async () => {
    const { create, tx } = fakeTx();
    await recordAudit(tx as never, {
      actorId: 'a-1', action: 'project.created', objectType: 'Project', objectId: 'p-1',
      previousState: {}, newState: { code: 'NP002' },
    });
    const { data } = create.mock.calls[0]![0] as { data: { subject: string; payload: Record<string, unknown> } };
    expect(data.subject).toBe(SUBJECTS.AUDIT_EVENT);
    expect(data.payload).toMatchObject({
      actorId: 'a-1', action: 'project.created', objectType: 'Project', objectId: 'p-1',
      previousState: {}, newState: { code: 'NP002' },
    });
  });

  it('carries the row id as the event id, so a retried publish deduplicates', async () => {
    const { create, tx } = fakeTx();
    await recordAudit(tx as never, {
      actorId: 'a-1', action: 'site.deleted', objectType: 'Site', objectId: 's-1',
      previousState: { siteCode: 'KOS121' }, newState: {},
    });
    const { data } = create.mock.calls[0]![0] as { data: { id: string; actorId: string | null } };
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.actorId).toBe('a-1');
  });

  it('leaves the row unpublished for the drainer to pick up', async () => {
    const { create, tx } = fakeTx();
    await recordAudit(tx as never, {
      actorId: 'a-1', action: 'task.updated', objectType: 'Task', objectId: 't-1',
      previousState: {}, newState: {},
    });
    const { data } = create.mock.calls[0]![0] as { data: { publishedAt: Date | null } };
    expect(data.publishedAt).toBeNull();
  });
});

describe('asJson', () => {
  it('turns the Dates Zod coerces into ISO strings', async () => {
    // A `Date` in a JSON column is rejected by Prisma's InputJsonObject, so a
    // DTO cannot be passed straight through. This is the conversion.
    const out = asJson({ targetDate: new Date('2026-09-25T00:00:00.000Z'), code: 'NP002' });
    expect(out).toEqual({ targetDate: '2026-09-25T00:00:00.000Z', code: 'NP002' });
  });

  it('drops undefined rather than emitting it, which JSON cannot hold', async () => {
    expect(asJson({ name: 'x', phase: undefined })).toEqual({ name: 'x' });
  });

  it('treats a missing value as an empty object', async () => {
    expect(asJson(undefined)).toEqual({});
  });
});
