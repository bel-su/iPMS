import { describe, expect, it, vi } from 'vitest';
import { SUBJECTS } from '@ipms/events';
import { ScopeConsumer, SCOPE_DURABLES } from './scope.consumer.js';

type Handler = (envelope: { eventId: string; payload: unknown }) => Promise<void>;

function build() {
  const handlers = new Map<string, Handler>();
  const durables: string[] = [];
  const consumer = {
    subscribe: vi.fn().mockImplementation(async (subject: string, durable: string, handler: Handler) => {
      handlers.set(subject, handler);
      durables.push(durable);
    }),
  };
  const repo = {
    applyGranted: vi.fn().mockResolvedValue(undefined),
    applyRevoked: vi.fn().mockResolvedValue(undefined),
    clearUser: vi.fn().mockResolvedValue(undefined),
  };
  return { consumer, repo, handlers, durables, subject: new ScopeConsumer(repo as never) };
}

describe('ScopeConsumer', () => {
  it('uses a distinct durable per subject', async () => {
    // A durable carries ONE filter_subject. Sharing one across subjects keeps
    // only the first filter -- consumers.add reports "already exists" for the
    // rest and DurableConsumer swallows it -- so the other subjects are never
    // delivered. That is how revocations stopped replicating while grants kept
    // working, leaving withdrawn access in place.
    const { subject, consumer, durables } = build();
    await subject.register(consumer as never);
    expect(durables).toHaveLength(3);
    expect(new Set(durables).size).toBe(3);
  });

  it('pairs each subject with its own durable', async () => {
    const { subject, consumer } = build();
    const pairs: Array<[string, string]> = [];
    const spy = { subscribe: async (subj: string, durable: string) => { pairs.push([subj, durable]); } };
    await subject.register(spy as never);
    for (const [subj, durable] of pairs) {
      expect(SCOPE_DURABLES[subj], subj).toBe(durable);
    }
    expect(consumer).toBeDefined();
  });

  it('does not consume role events', async () => {
    // iam's authoritative toScope() derives scope from the scope tables alone,
    // so a scoped role assignment confers no reach there. Projecting it here
    // would grant access iam does not recognise.
    const { subject, consumer, handlers } = build();
    await subject.register(consumer as never);
    expect([...handlers.keys()].sort()).toEqual([
      SUBJECTS.IAM_SCOPE_GRANTED, SUBJECTS.IAM_SCOPE_REVOKED, SUBJECTS.IAM_USER_DEACTIVATED,
    ].sort());
    expect(handlers.has(SUBJECTS.IAM_ROLE_ASSIGNED)).toBe(false);
    expect(handlers.has(SUBJECTS.IAM_ROLE_REMOVED)).toBe(false);
  });

  it('applies a grant', async () => {
    const { subject, consumer, handlers, repo } = build();
    await subject.register(consumer as never);
    const payload = { userId: 'u-1', level: 'PROJECT', projectId: 'p-1', siteId: null };
    await handlers.get(SUBJECTS.IAM_SCOPE_GRANTED)!({ eventId: 'e-1', payload });
    expect(repo.applyGranted).toHaveBeenCalledWith(payload);
  });

  it('applies a revocation', async () => {
    const { subject, consumer, handlers, repo } = build();
    await subject.register(consumer as never);
    const payload = { userId: 'u-1', level: 'GLOBAL', projectId: null, siteId: null };
    await handlers.get(SUBJECTS.IAM_SCOPE_REVOKED)!({ eventId: 'e-2', payload });
    expect(repo.applyRevoked).toHaveBeenCalledWith(payload);
  });

  it('clears every grant for a deactivated user', async () => {
    // Deactivation is not a per-grant revocation, so nothing else drops these
    // rows. Leaving them would keep a disabled account's reach replicated.
    const { subject, consumer, handlers, repo } = build();
    await subject.register(consumer as never);
    await handlers.get(SUBJECTS.IAM_USER_DEACTIVATED)!({ eventId: 'e-3', payload: { userId: 'u-1', tokenVersion: 4 } });
    expect(repo.clearUser).toHaveBeenCalledWith('u-1');
  });

  it('lets a handler failure propagate so the consumer can retry', async () => {
    // DurableConsumer nak/terms on a throw. Swallowing here would ack a grant
    // that was never projected, and the user would be denied until the next
    // unrelated event happened to arrive.
    const { subject, consumer, handlers, repo } = build();
    repo.applyGranted.mockRejectedValueOnce(new Error('database down'));
    await subject.register(consumer as never);
    await expect(
      handlers.get(SUBJECTS.IAM_SCOPE_GRANTED)!({ eventId: 'e-4', payload: {} }),
    ).rejects.toThrow(/database down/);
  });
});
