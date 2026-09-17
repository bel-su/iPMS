import { z } from 'zod';
import { randomBytes } from 'node:crypto';

let lastMs = 0;
let counter = 0;

/** UUIDv7: 48-bit big-endian timestamp, 4-bit version, 12-bit counter, 2-bit variant, 62-bit random. */
export function uuidv7(): string {
  const now = Date.now();
  if (now === lastMs) {
    counter = (counter + 1) & 0xfff;
  } else {
    lastMs = now;
    counter = 0;
  }

  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'Invalid UUID');
