import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { TemplateController } from './template.controller.js';
import type { TemplateQueries } from './template.queries.js';
import type { TemplateService } from './template.service.js';

function permissionOf(method: keyof TemplateController): string | undefined {
  const handler = TemplateController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

describe('permissions', () => {
  const EXPECTED: [keyof TemplateController, string][] = [
    ['list', 'qc_template.view'], ['get', 'qc_template.view'], ['getVersion', 'qc_template.view'],
    ['create', 'qc_template.create'], ['rename', 'qc_template.update'],
    ['startDraft', 'qc_template.update'], ['saveDraft', 'qc_template.update'], ['discardDraft', 'qc_template.update'],
    ['publish', 'qc_template.publish'], ['disable', 'qc_template.publish'], ['enable', 'qc_template.publish'],
  ];
  for (const [method, permission] of EXPECTED) {
    it(`${String(method)} requires ${permission}`, () => { expect(permissionOf(method)).toBe(permission); });
  }
});

describe('parsing', () => {
  const service = { publish: vi.fn(), saveDraft: vi.fn() };
  const queries = { getVersion: vi.fn() };
  const controller = new TemplateController(service as unknown as TemplateService, queries as unknown as TemplateQueries);
  const req = { user: { id: 'u-1' } } as never;

  it('refuses an id that is not a uuid before the service is reached', () => {
    expect(() => controller.publish('nope', req)).toThrow();
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('refuses a version that is not a positive integer', () => {
    expect(() => controller.getVersion('0192f7a0-0000-7000-8000-000000000001', '0')).toThrow();
    expect(queries.getVersion).not.toHaveBeenCalled();
  });

  it('refuses a draft save without a revision', () => {
    expect(() => controller.saveDraft('0192f7a0-0000-7000-8000-000000000001', { document: { sections: [] } })).toThrow();
    expect(service.saveDraft).not.toHaveBeenCalled();
  });
});
