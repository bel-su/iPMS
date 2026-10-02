import 'server-only';
import type { NotificationPage, UnreadCount } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The notification service's surface, reached through the gateway's
 * `/api/v1/notifications` prefix. The browser cannot call it itself — the
 * session cookie is http-only — so the route handlers under `app/api/notifications`
 * call these on its behalf.
 */

export interface ListNotificationsParams {
  limit?: string | undefined;
  cursor?: string | undefined;
  unreadOnly?: string | undefined;
}

export function listNotifications(params: ListNotificationsParams): Promise<ApiResult<NotificationPage>> {
  return authFetch<NotificationPage>('/api/v1/notifications', { query: { ...params } });
}

export function unreadCount(): Promise<ApiResult<UnreadCount>> {
  return authFetch<UnreadCount>('/api/v1/notifications/unread-count');
}

export function markRead(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllRead(): Promise<ApiResult<{ updated: number }>> {
  return authFetch<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST' });
}
