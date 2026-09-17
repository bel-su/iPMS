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
