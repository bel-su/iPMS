import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import type { PrismaClient } from '@prisma-clients/finance';

export interface TestActor { id: string; permissions: string[] }

const VIEW = ['finance_request.view'];
const VIEW_ALL = [...VIEW, 'finance_request.view_all'];

/** The permission sets the seed gives each role; keep in step with apps/iam/prisma/seed.ts. */
export const ACTORS = {
  engineer: { id: uuidv7(), permissions: [...VIEW, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit'] },
  otherEngineer: { id: uuidv7(), permissions: [...VIEW, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit'] },
  pm: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit', 'finance_approval.pm'] },
  otherPm: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit', 'finance_approval.pm'] },
  director: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_approval.director'] },
  finance: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_payment.record', 'finance_category.manage'] },
} satisfies Record<string, TestActor>;

export const PROJECT = { id: uuidv7(), code: 'KOS', name: 'Koshi Rollout' };
export const OTHER_PROJECT = { id: uuidv7(), code: 'GND', name: 'Gandaki Upgrade' };

export const scopes = {
  global: { global: true, projectIds: [], siteIds: [] } satisfies AuthzScope,
  project: { global: false, projectIds: [PROJECT.id], siteIds: [] } satisfies AuthzScope,
  otherProject: { global: false, projectIds: [OTHER_PROJECT.id], siteIds: [] } satisfies AuthzScope,
  none: { global: false, projectIds: [], siteIds: [] } satisfies AuthzScope,
};

/** Clears every table except the seeded categories. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "finance_request", "number_counter", "outbox_event" RESTART IDENTITY CASCADE');
}

export async function aCategory(prisma: PrismaClient): Promise<string> {
  return (await prisma.expenseCategory.findFirstOrThrow({ where: { disabledAt: null }, orderBy: { code: 'asc' } })).id;
}
