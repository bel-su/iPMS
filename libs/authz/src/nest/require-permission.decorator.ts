import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'ipms:permission';

export interface PermissionMetadata {
  permission: string;
  requireAssignment?: boolean;
}

export const RequirePermission = (permission: string, opts?: { requireAssignment?: boolean }) =>
  SetMetadata(PERMISSION_KEY, { permission, ...opts } satisfies PermissionMetadata);
