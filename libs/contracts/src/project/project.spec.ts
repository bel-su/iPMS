import { describe, expect, it } from 'vitest';
import {
  ListTasksQuerySchema,
  UpdateMilestoneSchema,
  UpdateSiteSchema,
  UpdateTaskSchema,
  UpdateTaskTypeSchema,
} from './project.js';

describe('UpdateSiteSchema', () => {
  it('accepts a single field', () => {
    expect(UpdateSiteSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('accepts a status, which create cannot set', () => {
    expect(UpdateSiteSchema.parse({ status: 'IN_DELIVERY' }).status).toBe('IN_DELIVERY');
  });

  it('refuses an unknown status', () => {
    expect(() => UpdateSiteSchema.parse({ status: 'MAYBE' })).toThrow();
  });

  it('refuses a site code that create would also refuse', () => {
    expect(() => UpdateSiteSchema.parse({ siteCode: 'lower case' })).toThrow();
  });
});

describe('UpdateTaskTypeSchema', () => {
  it('accepts isActive, which is how a task type is retired', () => {
    expect(UpdateTaskTypeSchema.parse({ isActive: false }).isActive).toBe(false);
  });
});

describe('UpdateMilestoneSchema', () => {
  it('treats taskTypeIds as a wholesale replacement, absent when not given', () => {
    expect(UpdateMilestoneSchema.parse({ name: 'Handover' }).taskTypeIds).toBeUndefined();
    expect(UpdateMilestoneSchema.parse({ taskTypeIds: [] }).taskTypeIds).toEqual([]);
  });
});

describe('UpdateTaskSchema', () => {
  it('accepts a status', () => {
    expect(UpdateTaskSchema.parse({ status: 'ONGOING' }).status).toBe('ONGOING');
  });

  it('accepts a null assignee, which is how a task is unassigned', () => {
    expect(UpdateTaskSchema.parse({ assigneeId: null }).assigneeId).toBeNull();
  });
});

describe('ListTasksQuerySchema', () => {
  it('defaults to no filter', () => {
    expect(ListTasksQuerySchema.parse({})).toEqual({});
  });

  it('refuses a siteId that is not a uuid', () => {
    expect(() => ListTasksQuerySchema.parse({ siteId: 'nope' })).toThrow();
  });
});
