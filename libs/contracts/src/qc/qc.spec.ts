import { describe, expect, it } from 'vitest';
import { ItemResponseInputSchema, SaveDraftSchema } from './qc.js';
import { TemplateItemInputSchema, PublishableDocumentSchema } from './template.js';

const ID = '0192f7a0-0000-7000-8000-000000000001';
const M1 = '0192f7a0-0000-7000-8000-0000000000a1';
const M2 = '0192f7a0-0000-7000-8000-0000000000a2';

describe('ItemResponseInputSchema', () => {
  it('reads mediaIds', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', mediaIds: [M1] }).mediaIds).toEqual([M1]);
  });
  it('reads the old photoMediaIds as mediaIds', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', photoMediaIds: [M1] }).mediaIds).toEqual([M1]);
  });
  it('prefers mediaIds when both are sent', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', photoMediaIds: [M1], mediaIds: [M2] }).mediaIds).toEqual([M2]);
  });
  it('defaults to no media and caps at 25', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS' }).mediaIds).toEqual([]);
    expect(() => ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', mediaIds: Array(26).fill(M1) })).toThrow();
  });
});

describe('SaveDraftSchema', () => {
  it('accepts a partial answer', () => {
    const parsed = SaveDraftSchema.parse({ deviceId: 'd1', deviceLabel: 'Pixel 7', baseVersion: 0, responses: [{ itemId: ID }] });
    expect(parsed.responses[0]).toEqual({ itemId: ID, mediaIds: [] });
  });
  it('refuses a negative base version', () => {
    expect(() => SaveDraftSchema.parse({ deviceId: 'd1', deviceLabel: 'P', baseVersion: -1, responses: [] })).toThrow();
  });
});

describe('video counts on template items', () => {
  const item = { number: '1.1', requirementText: 'Label' };
  it('default to zero', () => {
    expect(TemplateItemInputSchema.parse(item)).toMatchObject({ minVideos: 0, maxVideos: 0 });
  });
  it('are capped at 5', () => {
    expect(() => TemplateItemInputSchema.parse({ ...item, maxVideos: 6 })).toThrow();
  });
  it('need max ≥ min', () => {
    const result = PublishableDocumentSchema.safeParse({ sections: [{ number: '1', title: 'A', items: [{ ...item, minVideos: 2, maxVideos: 1 }] }] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('Must be at least Min Videos (2)');
  });
});
