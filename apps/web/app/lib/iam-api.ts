import 'server-only';
import { authFetch, type ApiResult } from './api-client';

/**
 * The slice of iam this app needs: who the caller is, and what they may do.
 *
 * `AuthzUser` is not re-used from `@ipms/authz` on purpose — that package is a
 * Nest library, and importing it here would pull guards, decorators and the
 * token signer into a Next build for the sake of one interface.
 */

export interface CurrentUser {
  id: string;
  roles: string[];
  permissions: string[];
  tokenVersion: number;
  isActive: boolean;
}

/**
 * The caller's identity as iam resolves it, not as the token asserts it.
 *
 * Worth the round trip: permissions are resolved server-side, so a role
 * changed after the token was issued is reflected here, and a page can hide a
 * control the gateway would refuse anyway.
 */
export async function getCurrentUser(): Promise<ApiResult<CurrentUser>> {
  return authFetch<CurrentUser>('/api/v1/auth/me');
}

/** True when the signed-in user holds this permission — for hiding controls, never for enforcement. */
export function hasPermission(user: CurrentUser, permission: string): boolean {
  return user.isActive && user.permissions.includes(permission);
}
