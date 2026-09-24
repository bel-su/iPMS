import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PERMISSION_KEY, type AuthzScope, type PermissionMetadata } from '@ipms/authz';
import { WorkOrderController } from './work-order.controller.js';
import type { WorkOrderService } from './work-order.service.js';

const SCOPE: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const ID = '0192f7a0-0000-7000-8000-000000000001';
const BODY = {
  workOrderType: 'EHS_SELF_CHECK', templateId: ID, siteId: ID, assigneeId: ID,
  plannedCompletionAt: '2026-09-30', title: '[EHS Self-check]KOS102X',
};

function permissionOf(method: keyof WorkOrderController): string | undefined {
  const handler = WorkOrderController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

const make = () => {
  const service = { create: vi.fn(), list: vi.fn() };
  return { service, controller: new WorkOrderController(service as unknown as WorkOrderService) };
};
const req = (permissions: string[]) => ({ user: { id: 'u-1', permissions }, headers: { authorization: 'Bearer t' } }) as never;

describe('WorkOrderController', () => {
  it('lists with task.view and creates with task.create', () => {
    expect(permissionOf('list')).toBe('task.view');
    expect(permissionOf('create')).toBe('task.create');
  });

  it('also requires task.assign to create, since a work order is created assigned', () => {
    const { controller, service } = make();
    expect(() => controller.create(SCOPE, ID, BODY, req(['task.create']))).toThrow(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('forwards the caller’s token for the template check', () => {
    const { controller, service } = make();
    controller.create(SCOPE, ID, BODY, req(['task.create', 'task.assign']));
    expect(service.create).toHaveBeenCalledWith(SCOPE, ID, expect.objectContaining({ workOrderType: 'EHS_SELF_CHECK' }), 'u-1', 'Bearer t');
  });

  it('parses the list query', () => {
    const { controller, service } = make();
    controller.list(SCOPE, ID, { page: '2', status: 'REVIEWING' });
    expect(service.list).toHaveBeenCalledWith(SCOPE, ID, { page: 2, limit: 20, status: 'REVIEWING' });
  });

  it('refuses a malformed body before the service is reached', () => {
    const { controller, service } = make();
    expect(() => controller.create(SCOPE, ID, { ...BODY, siteId: 'nope' }, req(['task.create', 'task.assign']))).toThrow();
    expect(service.create).not.toHaveBeenCalled();
  });
});
