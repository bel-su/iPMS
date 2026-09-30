import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY } from '@ipms/authz';
import { DraftController } from './draft.controller.js';

const reflect = Reflect as unknown as { getMetadata(key: string, target: object): unknown };
const permissionOf = (method: string) =>
  (reflect.getMetadata(PERMISSION_KEY, (DraftController.prototype as unknown as Record<string, object>)[method]!) as { permission: string } | undefined)?.permission;

describe('draft routes', () => {
  it.each(['get', 'save', 'takeover'])('%s needs qc_submission.update', (method) => {
    expect(permissionOf(method)).toBe('qc_submission.update');
  });
});
