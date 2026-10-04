import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const ROW = { createdAt: new Date('2026-10-02T08:00:00.123Z'), id: '0192f7a0-0000-7000-8000-000000000001' };

describe('cursor', () => {
  it('round-trips a row position', () => {
    expect(decodeCursor(encodeCursor(ROW))).toEqual(ROW);
  });

  it('refuses garbage, a bad timestamp and a bad id', () => {
    const forge = (text: string) => Buffer.from(text).toString('base64url');
    expect(() => decodeCursor('%%%')).toThrow('Invalid cursor');
    expect(() => decodeCursor(forge('not-a-date|' + ROW.id))).toThrow('Invalid cursor');
    expect(() => decodeCursor(forge(ROW.createdAt.toISOString() + '|nope'))).toThrow('Invalid cursor');
    expect(() => decodeCursor(forge(`${ROW.createdAt.toISOString()}|${ROW.id}|extra`))).toThrow('Invalid cursor');
  });
});
