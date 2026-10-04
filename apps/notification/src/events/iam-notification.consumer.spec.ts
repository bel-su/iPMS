import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, IamScopeExpiring } from '@ipms/events';
import { IamNotificationConsumer } from './iam-notification.consumer.js';

const EXPIRING: IamScopeExpiring = {
  userId: 'u-eng', userName: 'Jane Doe', daysLeft: 12,
  grants: [{ projectId: 'p-1', expiresAt: '2026-10-15T00:00:00Z' }, { projectId: 'p-2', expiresAt: '2026-10-20T00:00:00Z' }],
  managerIds: ['u-pm', 'u-eng', 'u-pm'],
};
const envelope = (payload: IamScopeExpiring): EventEnvelope<IamScopeExpiring> => ({
  eventId: 'evt-1', subject: 'iam.scope.expiring', occurredAt: '2026-10-03T00:00:00Z', version: 1, correlationId: 'c', actorId: null, payload,
});

describe('IamNotificationConsumer.onExpiring', () => {
  it('tells the engineer and each manager once, and not the engineer twice', async () => {
    const notifications = { createMany: vi.fn().mockResolvedValue(2) };
    await new IamNotificationConsumer(notifications as never, {} as never).onExpiring(envelope(EXPIRING));
    const items = notifications.createMany.mock.calls[0]![0] as Array<{ recipientId: string; title: string; body: string; actionUrl: string | null; eventId: string }>;
    expect(items.map((i) => i.recipientId)).toEqual(['u-eng', 'u-pm']);
    expect(items[0]).toMatchObject({ title: 'Your project access is ending', actionUrl: null, eventId: 'evt-1' });
    expect(items[0]!.body).toContain('2 projects');
    expect(items[0]!.body).toContain('in 12 days');
    expect(items[1]).toMatchObject({ actionUrl: '/users/u-eng' });
    expect(items[1]!.title).toContain('Jane Doe');
  });
});
