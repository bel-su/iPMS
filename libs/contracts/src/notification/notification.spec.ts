import { describe, expect, it } from 'vitest';
import { ListNotificationsQuerySchema, NotificationIdSchema } from './notification.js';

describe('ListNotificationsQuerySchema', () => {
  it('defaults to 20 items, read and unread', () => {
    expect(ListNotificationsQuerySchema.parse({})).toEqual({ limit: 20, unreadOnly: false });
  });

  it('coerces a query string', () => {
    expect(ListNotificationsQuerySchema.parse({ limit: '5', unreadOnly: 'true', cursor: 'abc' }))
      .toEqual({ limit: 5, unreadOnly: true, cursor: 'abc' });
  });

  it('refuses a limit above 50', () => {
    expect(() => ListNotificationsQuerySchema.parse({ limit: '51' })).toThrow();
  });

  it('refuses unreadOnly values other than true or false', () => {
    expect(() => ListNotificationsQuerySchema.parse({ unreadOnly: 'yes' })).toThrow();
  });
});

describe('NotificationIdSchema', () => {
  it('accepts any UUID shape, including non-v7 ids from seed data', () => {
    expect(NotificationIdSchema.safeParse('77777777-1111-1111-1111-111111111111').success).toBe(true);
  });

  it('refuses anything else', () => {
    expect(NotificationIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
