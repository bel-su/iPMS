import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY } from '@ipms/authz';
import { AttachController } from './attach/attach.controller.js';
import { UploadController } from './uploads/upload.controller.js';
import { ViewController } from './viewing/view.controller.js';

const reflect = Reflect as unknown as { getMetadata(key: string, target: object): unknown };
const permissionOf = (controller: { prototype: object }, method: string) =>
  (reflect.getMetadata(PERMISSION_KEY, (controller.prototype as Record<string, object>)[method]!) as { permission: string } | undefined)?.permission;

/** Every route names its permission: a route without one would be open to any signed-in user. */
describe('media route permissions', () => {
  it.each([
    [UploadController, 'status', 'qc_evidence.upload'],
    [UploadController, 'register', 'qc_evidence.upload'],
    [UploadController, 'parts', 'qc_evidence.upload'],
    [UploadController, 'complete', 'qc_evidence.upload'],
    [UploadController, 'discard', 'qc_evidence.upload'],
    [ViewController, 'url', 'qc_submission.view'],
    [ViewController, 'list', 'qc_submission.view'],
    [AttachController, 'attach', 'qc_submission.submit'],
    [AttachController, 'check', 'qc_submission.submit'],
  ] as const)('%o.%s needs %s', (controller, method, code) => {
    expect(permissionOf(controller, method)).toBe(code);
  });
});
