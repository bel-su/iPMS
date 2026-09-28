import { describe, expect, it } from 'vitest';
import { sniffMatches } from './sniff.js';

describe('sniffMatches', () => {
  it('recognises a JPEG by its SOI marker', () => {
    expect(sniffMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(sniffMatches('image/jpeg', Buffer.from('<html>......'))).toBe(false);
  });

  it('recognises an MP4 by its ftyp box', () => {
    expect(sniffMatches('video/mp4', Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]))).toBe(true);
    expect(sniffMatches('video/mp4', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it('refuses anything else', () => {
    expect(sniffMatches('application/pdf', Buffer.from('%PDF-1.7....'))).toBe(false);
  });
});
