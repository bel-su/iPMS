import { describe, expect, it } from 'vitest';
import {
  CancelWorkOrderSchema, CreateWorkOrdersSchema, ListWorkOrdersQuerySchema, UpdateWorkOrderSchema,
  WORK_ORDER_BATCH_LIMIT, WORK_ORDER_TEMPLATE_CATEGORY, workOrderTitle,
} from './work-order.js';

const ID = '0190a9b8-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const ID2 = '0190a9b8-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const valid = {
  projectId: ID, workOrderType: 'QUALITY_SELF_CHECK', templateId: ID, siteIds: [ID, ID2], assigneeId: ID,
  plannedCompletionAt: '2026-09-30',
};

describe('CreateWorkOrdersSchema', () => {
  it('accepts a batch and coerces the date', () => {
    const parsed = CreateWorkOrdersSchema.parse(valid);
    expect(parsed.plannedCompletionAt).toBeInstanceOf(Date);
    expect(parsed.siteIds).toHaveLength(2);
  });

  it.each(['workOrderType', 'templateId', 'siteIds', 'assigneeId', 'plannedCompletionAt'])('requires %s', (field) => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest[field];
    expect(CreateWorkOrdersSchema.safeParse(rest).success).toBe(false);
  });

  it('needs at least one site and refuses a site twice', () => {
    expect(CreateWorkOrdersSchema.safeParse({ ...valid, siteIds: [] }).success).toBe(false);
    expect(CreateWorkOrdersSchema.safeParse({ ...valid, siteIds: [ID, ID] }).success).toBe(false);
  });

  it('caps the batch', () => {
    const many = Array.from({ length: WORK_ORDER_BATCH_LIMIT + 1 }, (_, i) => `0190a9b8-1c2d-7e3f-8a4b-${String(i).padStart(12, '0')}`);
    expect(CreateWorkOrdersSchema.safeParse({ ...valid, siteIds: many }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(CreateWorkOrdersSchema.safeParse({ ...valid, workOrderType: 'CIVIL_CHECK' }).success).toBe(false);
  });
});

describe('UpdateWorkOrderSchema', () => {
  it('needs a change', () => {
    expect(UpdateWorkOrderSchema.safeParse({}).success).toBe(false);
    expect(UpdateWorkOrderSchema.safeParse({ assigneeId: ID }).success).toBe(true);
    expect(UpdateWorkOrderSchema.parse({ plannedCompletionAt: '2026-10-01' }).plannedCompletionAt).toBeInstanceOf(Date);
  });
});

describe('CancelWorkOrderSchema', () => {
  it('needs a reason', () => {
    expect(CancelWorkOrderSchema.safeParse({ reason: ' ' }).success).toBe(false);
    expect(CancelWorkOrderSchema.parse({ reason: ' Site handed back ' }).reason).toBe('Site handed back');
  });
});

describe('ListWorkOrdersQuerySchema', () => {
  it('defaults the page and limit', () => {
    expect(ListWorkOrdersQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces paging and keeps filters', () => {
    expect(ListWorkOrdersQuerySchema.parse({ page: '3', view: 'overdue', projectId: ID })).toEqual({ page: 3, limit: 20, view: 'overdue', projectId: ID });
  });

  it('refuses a limit above 100', () => {
    expect(ListWorkOrdersQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('workOrderTitle', () => {
  it('prefixes the site name with the type label and appends the note', () => {
    expect(workOrderTitle('QUALITY_SELF_CHECK', 'SAKUWA GACHHI')).toBe('[Quality Self-check]SAKUWA GACHHI');
    expect(workOrderTitle('EHS_SPOT_CHECK', 'KOS102X', '  sector 2 ')).toBe('[EHS Spot Check]KOS102X sector 2');
  });

  it('never exceeds 250 characters', () => {
    expect(workOrderTitle('EHS_SELF_CHECK', 'S'.repeat(300))).toHaveLength(250);
  });
});

describe('WORK_ORDER_TEMPLATE_CATEGORY', () => {
  it('maps each type to the template category it may use', () => {
    expect(WORK_ORDER_TEMPLATE_CATEGORY).toEqual({
      QUALITY_SELF_CHECK: 'QUALITY', QUALITY_SPOT_CHECK: 'QUALITY', EHS_SELF_CHECK: 'EHS', EHS_SPOT_CHECK: 'EHS',
    });
  });
});
