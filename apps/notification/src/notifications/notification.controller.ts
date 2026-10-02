import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ListNotificationsQuerySchema, NotificationIdSchema,
  type NotificationPage, type UnreadCount,
} from '@ipms/contracts';
import { CurrentUserId } from '../http/current-user.js';
import { NotificationService } from './notification.service.js';

/**
 * No `@RequirePermission` here, on purpose. A signed-in user may read and mark
 * their own notifications and nobody else's, and that boundary is the
 * `recipientId` filter in `NotificationService`, not a permission code.
 * `JwtUserGuard` still runs on every route, so the caller is always verified.
 * Do not add `@Public()` to anything in this class.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(@CurrentUserId() userId: string, @Query() query: unknown): Promise<NotificationPage> {
    return this.notifications.list(userId, ListNotificationsQuerySchema.parse(query));
  }

  @Get('unread-count')
  async unreadCount(@CurrentUserId() userId: string): Promise<UnreadCount> {
    return { count: await this.notifications.unreadCount(userId) };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUserId() userId: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(userId) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@CurrentUserId() userId: string, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(userId, NotificationIdSchema.parse(id));
  }
}
