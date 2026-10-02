import { BadRequestException } from '@nestjs/common';
import { NotificationIdSchema } from '@ipms/contracts';

export interface Cursor {
  createdAt: Date;
  id: string;
}

/** Opaque to clients: `createdAt|id`, base64url. Both halves are validated on the way back in. */
export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

export function decodeCursor(value: string): Cursor {
  const [iso, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  const valid = rest.length === 0
    && id !== undefined
    && NotificationIdSchema.safeParse(id).success
    && !Number.isNaN(createdAt.getTime())
    // Round-trip check: `new Date('2026')` parses, and must not be accepted as a position.
    && createdAt.toISOString() === iso;
  if (!valid) throw new BadRequestException('Invalid cursor');
  return { createdAt, id: id as string };
}
