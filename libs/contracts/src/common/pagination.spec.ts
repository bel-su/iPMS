import { describe, expect, it } from 'vitest';
import { PaginationSchema } from './pagination.js';

describe('PaginationSchema', () => {
  it('defaults to page 1 limit 20', () => {
    expect(PaginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces numeric query strings', () => {
    expect(PaginationSchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
  });

  it('caps limit at 100 to prevent unbounded reads', () => {
    expect(PaginationSchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('rejects page below 1', () => {
    expect(PaginationSchema.safeParse({ page: 0 }).success).toBe(false);
  });
});
