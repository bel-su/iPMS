import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'QC_SUBMISSION_SUBMITTED',
  'QC_SUBMISSION_APPROVED',
  'QC_SUBMISSION_REJECTED',
  'FINANCE_APPROVAL_NEEDED',
  'FINANCE_PAYMENT_DUE',
  'FINANCE_REQUEST_APPROVED',
  'FINANCE_REQUEST_RETURNED',
  'FINANCE_REQUEST_REJECTED',
  'FINANCE_REQUEST_CANCELLED',
  'FINANCE_REQUEST_PAID',
  'FINANCE_SETTLEMENT_SETTLED',
  'FINANCE_CASH_RETURNED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * `type` is a plain string, not `NotificationType`: the column is a varchar and
 * seeded or future rows carry types this slice does not emit.
 */
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  workOrderId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
}

export interface UnreadCount {
  count: number;
}

export const ListNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(200).optional(),
  unreadOnly: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * Any UUID shape, not `UuidSchema`: that one demands v7, and ids in seeded
 * environments are not.
 */
export const NotificationIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Invalid id',
);
