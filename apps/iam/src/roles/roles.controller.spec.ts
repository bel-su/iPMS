import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@ipms/contracts';
import { RolesController } from './roles.controller.js';

const ACTOR = uuidv7();

const ROLES = [
  { id: uuidv7(), code: 'SUPER_ADMIN', name: 'Super Administrator', isActive: true },
  { id: uuidv7(), code: 'PROJECT_MANAGER', name: 'Project Manager', isActive: true },
  { id: uuidv7(), code: 'QC_MANAGER', name: 'QC Manager', isActive: true },
  { id: uuidv7(), code: 'FIELD_ENGINEER', name: 'Field Engineer', isActive: true },
];

function build() {
  const roles = { list: vi.fn().mockResolvedValue(ROLES) };
  return { controller: new RolesController(roles as never), roles };
}

function req(roleCodes: string[]) {
  return { user: { id: ACTOR, roles: roleCodes, permissions: [], tokenVersion: 0, isActive: true } };
}

/**
 * The web app filters its role checkboxes on this flag because it cannot import
 * the assignable-roles table — `@ipms/authz` reaches `@nestjs/common`, which a
 * Next build cannot resolve. Reporting the answer here is what keeps the rule
 * in one place instead of two that can drift.
 */
describe('GET /roles assignable flag', () => {
  it('marks every role assignable for a super administrator', async () => {
    const { controller } = build();
    const listed = await controller.list(req(['SUPER_ADMIN']) as never);
    expect(listed.every((role) => role.assignable)).toBe(true);
  });

  it('marks only field engineers and QC managers assignable for a project manager', async () => {
    const { controller } = build();
    const listed = await controller.list(req(['PROJECT_MANAGER']) as never);
    const assignable = listed.filter((role) => role.assignable).map((role) => role.code);
    expect(assignable.sort()).toEqual(['FIELD_ENGINEER', 'QC_MANAGER']);
  });

  it('marks nothing assignable for a role that confers no assignment authority', async () => {
    const { controller } = build();
    const listed = await controller.list(req(['QC_MANAGER']) as never);
    expect(listed.some((role) => role.assignable)).toBe(false);
  });

  it('leaves the rest of each role untouched', async () => {
    const { controller } = build();
    const listed = await controller.list(req(['SUPER_ADMIN']) as never);
    expect(listed[0]).toMatchObject({ code: 'SUPER_ADMIN', name: 'Super Administrator', isActive: true });
  });
});
