import { describe, expect, it } from 'vitest';
import { CreateWorkOrderSchema, ListWorkOrdersQuerySchema, WORK_ORDER_TEMPLATE_CATEGORY } from './work-order.js';

const ID = '0190a9b8-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const valid = {
  workOrderType: 'QUALITY_SELF_CHECK', templateId: ID, siteId: ID, assigneeId: ID,
  plannedCompletionAt: '2026-09-30', title: '[Quality Self-check]SAKUWA GACHHI',
};

describe('CreateWorkOrderSchema', () => {
  it('accepts a complete work order and coerces the date', () => {
    const parsed = CreateWorkOrderSchema.parse(valid);
    expect(parsed.plannedCompletionAt).toBeInstanceOf(Date);
  });

  it.each(['workOrderType', 'templateId', 'siteId', 'assigneeId', 'plannedCompletionAt', 'title'])('requires %s', (field) => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest[field];
    expect(CreateWorkOrderSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a blank title', () => {
    expect(CreateWorkOrderSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(CreateWorkOrderSchema.safeParse({ ...valid, workOrderType: 'CIVIL_CHECK' }).success).toBe(false);
  });
});

describe('ListWorkOrdersQuerySchema', () => {
  it('defaults the page and limit', () => {
    expect(ListWorkOrdersQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces paging from a query string', () => {
    expect(ListWorkOrdersQuerySchema.parse({ page: '3', limit: '50', status: 'COMPLETED' })).toEqual({ page: 3, limit: 50, status: 'COMPLETED' });
  });

  it('refuses a limit above 100', () => {
    expect(ListWorkOrdersQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('WORK_ORDER_TEMPLATE_CATEGORY', () => {
  it('maps each type to the template category it may use', () => {
    expect(WORK_ORDER_TEMPLATE_CATEGORY).toEqual({
      QUALITY_SELF_CHECK: 'QUALITY', QUALITY_SPOT_CHECK: 'QUALITY', EHS_SELF_CHECK: 'EHS', EHS_SPOT_CHECK: 'EHS',
    });
  });
});
