import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import type { Prisma } from '@prisma-clients/finance';

export type Tx = Prisma.TransactionClient;

/** The authenticated caller, as the JWT guard resolves them. */
export interface Actor { id: string; permissions: string[] }

/** The project facts a request snapshots at creation, so reports need no cross-service call. */
export interface ProjectRef { id: string; code: string; name: string }

/** True when the caller's project scope reaches the project. */
export const inScope = (scope: AuthzScope, projectId: string): boolean => scope.global || scope.projectIds.includes(projectId);

export function requirePermission(actor: Actor, permission: string): void {
  if (!actor.permissions.includes(permission)) throw new ForbiddenException(`This needs the ${permission} permission`);
}

/** Used for both "missing" and "not yours", so a request's existence is not disclosed. */
export const notFound = (what: string): NotFoundException => new NotFoundException(`${what} not found`);
