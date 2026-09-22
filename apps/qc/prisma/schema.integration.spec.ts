import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const version = (templateId: string, n: number, status: string) => prisma.templateVersion.create({
  data: { id: uuidv7(), templateId, version: n, status, source: 'WEB', createdBy: ACTOR },
});

describe('template_version partial unique indexes', () => {
  it('refuses a second draft for one template', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await version(templateId, 2, 'DRAFT');
    await expect(version(templateId, 3, 'DRAFT')).rejects.toThrow();
  });

  it('refuses a second published version for one template', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(version(templateId, 2, 'PUBLISHED')).rejects.toThrow();
  });

  it('allows any number of retired versions', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await version(templateId, 2, 'RETIRED');
    await expect(version(templateId, 3, 'RETIRED')).resolves.toBeTruthy();
  });

  it('refuses a duplicate code company-wide', async () => {
    await seedPublishedTemplate(prisma, { code: 'SAME' });
    await expect(seedPublishedTemplate(prisma, { code: 'SAME' })).rejects.toThrow();
  });
});
