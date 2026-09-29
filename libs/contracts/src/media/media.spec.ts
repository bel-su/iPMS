import { describe, expect, it } from 'vitest';
import {
  AttachRequestSchema, MEDIA_LIMITS, MIB, RegisterUploadSchema, UploadStatusRequestSchema, partCountFor,
} from './media.js';

const id = (n: number) => `0192f7a0-0000-7000-8000-${n.toString().padStart(12, '0')}`;
const valid = {
  id: id(1), category: 'EVIDENCE', workOrderId: id(2), checklistItemId: id(3), kind: 'PHOTO',
  contentType: 'image/jpeg', sizeBytes: 1_200_000, contentHash: 'a'.repeat(64),
  capturedAt: '2026-09-28T08:00:00Z', latitude: 26.45, longitude: 87.28, deviceId: 'RMX3630-7f2c',
};

describe('RegisterUploadSchema', () => {
  it('accepts a phone registration and coerces the capture time', () => {
    const parsed = RegisterUploadSchema.parse(valid);
    expect(parsed.capturedAt).toBeInstanceOf(Date);
  });

  it('accepts a registration without a GPS fix', () => {
    const { latitude: _lat, longitude: _lng, ...noFix } = valid;
    expect(RegisterUploadSchema.safeParse(noFix).success).toBe(true);
  });

  it.each([
    ['an upper-case hash', { contentHash: 'A'.repeat(64) }],
    ['a short hash', { contentHash: 'a'.repeat(63) }],
    ['a gallery upload (not in media core)', { category: 'GALLERY' }],
    ['a document kind', { kind: 'DOCUMENT' }],
    ['a latitude off the planet', { latitude: 91 }],
    ['a zero size', { sizeBytes: 0 }],
    ['a v4 id', { id: '3b241101-e2bb-4255-8caf-4136c566a962' }],
  ])('refuses %s', (_label, patch) => {
    expect(RegisterUploadSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('limits and parts', () => {
  it('matches the agreed limits', () => {
    expect(MEDIA_LIMITS.PHOTO.maxBytes).toBe(5 * MIB);
    expect(MEDIA_LIMITS.VIDEO.maxBytes).toBe(100 * MIB);
    expect(MEDIA_LIMITS.DOCUMENT.maxBytes).toBe(20 * MIB);
  });

  it('splits a 100 MiB video into 20 parts and rounds a remainder up', () => {
    expect(partCountFor(100 * MIB)).toBe(20);
    expect(partCountFor(10 * MIB + 1)).toBe(3);
  });
});

describe('batch sizes', () => {
  it('caps the status check at 200 ids', () => {
    expect(UploadStatusRequestSchema.safeParse({ ids: Array.from({ length: 200 }, (_, i) => id(i)) }).success).toBe(true);
    expect(UploadStatusRequestSchema.safeParse({ ids: Array.from({ length: 201 }, (_, i) => id(i)) }).success).toBe(false);
  });

  it('refuses an empty attach', () => {
    expect(AttachRequestSchema.safeParse({ submissionId: id(1), workOrderId: id(2), siteId: id(3), mediaIds: [] }).success).toBe(false);
  });

  it('requires a workOrderId on attach', () => {
    expect(AttachRequestSchema.safeParse({ submissionId: id(1), siteId: id(2), mediaIds: [id(3)] }).success).toBe(false);
    expect(AttachRequestSchema.safeParse({ submissionId: id(1), workOrderId: id(2), siteId: id(3), mediaIds: [id(4)] }).success).toBe(true);
  });
});
