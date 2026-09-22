import { describe, expect, it } from 'vitest';
import { assignableRoles, mayAssign, mayManage } from './assignable-roles.js';

describe('assignableRoles', () => {
  it('gives a super administrator every role', () => {
    expect(assignableRoles(['SUPER_ADMIN'])).toBe('ALL');
  });

  it('gives a project manager field engineers and QC managers, and nothing else', () => {
    const allowed = assignableRoles(['PROJECT_MANAGER']);
    expect(allowed).toEqual(new Set(['FIELD_ENGINEER', 'QC_MANAGER']));
  });

  it('unions the sets of an actor holding two listed roles', () => {
    expect(assignableRoles(['PROJECT_MANAGER', 'QC_MANAGER']))
      .toEqual(new Set(['FIELD_ENGINEER', 'QC_MANAGER']));
  });

  // Fail closed: a custom role created through RolesController confers no
  // assignment authority until it is added to the table deliberately.
  it('gives an unlisted role nothing', () => {
    expect(assignableRoles(['QC_MANAGER'])).toEqual(new Set());
    expect(assignableRoles([])).toEqual(new Set());
  });

  it('lets ALL win over a narrower role held at the same time', () => {
    expect(assignableRoles(['PROJECT_MANAGER', 'SUPER_ADMIN'])).toBe('ALL');
  });
});

describe('mayAssign', () => {
  it('refuses a project manager the administrator role', () => {
    expect(mayAssign(['PROJECT_MANAGER'], 'SUPER_ADMIN')).toBe(false);
  });

  it('refuses a project manager their own role', () => {
    expect(mayAssign(['PROJECT_MANAGER'], 'PROJECT_MANAGER')).toBe(false);
  });

  it('allows a project manager the two team roles', () => {
    expect(mayAssign(['PROJECT_MANAGER'], 'FIELD_ENGINEER')).toBe(true);
    expect(mayAssign(['PROJECT_MANAGER'], 'QC_MANAGER')).toBe(true);
  });

  it('allows a super administrator anything, including a custom role', () => {
    expect(mayAssign(['SUPER_ADMIN'], 'QC_INSPECTOR')).toBe(true);
  });
});

describe('mayManage', () => {
  it('lets a project manager manage a field engineer', () => {
    expect(mayManage(['PROJECT_MANAGER'], ['FIELD_ENGINEER'])).toBe(true);
  });

  it('refuses a project manager a target who also holds an unassignable role', () => {
    expect(mayManage(['PROJECT_MANAGER'], ['FIELD_ENGINEER', 'SUPER_ADMIN'])).toBe(false);
  });

  /**
   * A roleless account has no authority to capture, and refusing here would
   * strand a user that an error left without an assignment.
   */
  it('lets anyone manage a user who holds no roles', () => {
    expect(mayManage(['PROJECT_MANAGER'], [])).toBe(true);
  });

  it('lets a super administrator manage anyone', () => {
    expect(mayManage(['SUPER_ADMIN'], ['SUPER_ADMIN'])).toBe(true);
  });
});
