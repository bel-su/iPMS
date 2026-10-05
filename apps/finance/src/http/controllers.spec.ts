import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { PERMISSION_CODES } from '@ipms/authz';
import { CategoryController } from './category.controller.js';
import { ReportController } from './report.controller.js';
import { RequestController } from './request.controller.js';

const gate = (controller: { prototype: object }, handler: string): string | undefined =>
  (Reflect.getMetadata(PERMISSION_KEY, (controller.prototype as Record<string, object>)[handler]!) as PermissionMetadata | undefined)?.permission;

describe('route permissions', () => {
  it.each([
    [RequestController, 'create', 'finance_request.view'],
    [RequestController, 'approve', 'finance_request.view'],
    [RequestController, 'pay', 'finance_payment.record'],
    [RequestController, 'returnCash', 'finance_payment.record'],
    [RequestController, 'list', 'finance_request.view'],
    [CategoryController, 'create', 'finance_category.manage'],
    [CategoryController, 'update', 'finance_category.manage'],
    [CategoryController, 'list', 'finance_request.view'],
    [ReportController, 'spend', 'finance_request.view_all'],
  ] as const)('%o.%s requires %s', (controller, handler, permission) => {
    expect(gate(controller, handler)).toBe(permission);
    expect(PERMISSION_CODES.has(permission)).toBe(true);
  });

  it('gates every handler of every finance controller', () => {
    for (const controller of [RequestController, CategoryController, ReportController]) {
      const handlers = Object.getOwnPropertyNames(controller.prototype).filter((n) => n !== 'constructor' && typeof (controller.prototype as unknown as Record<string, unknown>)[n] === 'function' && n !== 'scope');
      for (const name of handlers) expect(gate(controller, name), `${controller.name}.${name} has no @RequirePermission`).toBeDefined();
    }
  });
});
