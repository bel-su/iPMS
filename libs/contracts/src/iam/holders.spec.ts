import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../common/ids.js';
import { HoldersRequestSchema, HoldersResultSchema } from './holders.js';

describe('HoldersRequestSchema', () => {
  it('accepts a permission and a project id', () => {
    const projectId = uuidv7();
    expect(HoldersRequestSchema.parse({ permission: 'qc_review.approve', projectId })).toEqual({ permission: 'qc_review.approve', projectId });
  });

  it('refuses an empty permission or a bad project id', () => {
    expect(() => HoldersRequestSchema.parse({ permission: '', projectId: uuidv7() })).toThrow();
    expect(() => HoldersRequestSchema.parse({ permission: 'x', projectId: 'nope' })).toThrow();
  });
});

describe('HoldersResultSchema', () => {
  it('requires an array of strings', () => {
    expect(HoldersResultSchema.parse({ userIds: ['a'] })).toEqual({ userIds: ['a'] });
    expect(() => HoldersResultSchema.parse({ userIds: 'a' })).toThrow();
  });
});
