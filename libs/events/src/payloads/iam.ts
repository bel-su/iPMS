export interface IamScopeGranted {
  userId: string;
  level: 'GLOBAL' | 'PROJECT' | 'SITE';
  projectId: string | null;
  siteId: string | null;
}

export interface IamScopeRevoked {
  userId: string;
  level: 'GLOBAL' | 'PROJECT' | 'SITE';
  projectId: string | null;
  siteId: string | null;
}

export interface IamRoleAssigned {
  userId: string;
  roleCode: string;
  projectId: string | null;
  siteId: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface IamRoleRemoved {
  userId: string;
  roleCode: string;
}

export interface IamUserDeactivated {
  userId: string;
  tokenVersion: number;
}

export interface IamUserUpdated {
  userId: string;
  fullName?: string;
  email?: string;
  employeeCode?: string | null;
  phone?: string | null;
}

/**
 * A user's project access is about to lapse. `managerIds` are the people who may
 * renew it; iam works them out because it owns the grants and the permissions.
 */
export interface IamScopeExpiring {
  userId: string;
  userName: string;
  /** Whole days until the earliest of `grants` lapses. */
  daysLeft: number;
  grants: Array<{ projectId: string; expiresAt: string }>;
  managerIds: string[];
}
