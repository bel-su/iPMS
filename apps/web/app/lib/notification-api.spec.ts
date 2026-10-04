import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));
const api = await import('./notification-api');
beforeEach(() => { authFetch.mockClear(); });

describe('notification-api', () => {
  it('lists with only the parameters it was given', async () => {
    await api.listNotifications({ limit: '20', cursor: 'abc', unreadOnly: undefined });
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications', { query: { limit: '20', cursor: 'abc', unreadOnly: undefined } });
  });

  it('reads the unread count', async () => {
    await api.unreadCount();
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications/unread-count');
  });

  it('marks one read with a POST', async () => {
    await api.markRead('n-1');
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications/n-1/read', { method: 'POST' });
  });

  it('marks all read with a POST', async () => {
    await api.markAllRead();
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications/read-all', { method: 'POST' });
  });
});
