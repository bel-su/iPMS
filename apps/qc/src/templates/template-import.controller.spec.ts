import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { TemplateImportController } from './template-import.controller.js';

function permissionOf(method: keyof TemplateImportController): string | undefined {
  const handler = TemplateImportController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

describe('permissions', () => {
  const EXPECTED: [keyof TemplateImportController, string][] = [
    ['blank', 'qc_template.view'], ['exportVersion', 'qc_template.view'],
    ['preview', 'qc_template.import'], ['commit', 'qc_template.import'],
  ];
  for (const [method, permission] of EXPECTED) {
    it(`${String(method)} requires ${permission}`, () => { expect(permissionOf(method)).toBe(permission); });
  }
});
