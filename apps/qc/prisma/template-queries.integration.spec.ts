import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateQueries } from '../src/templates/template.queries.js';
import { TemplateService } from '../src/templates/template.service.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let queries: TemplateQueries;
let service: TemplateService;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  queries = new TemplateQueries(prisma);
  service = new TemplateService(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

describe('list', () => {
  it('sorts each tab by code and counts the current version in SQL', async () => {
    const enabled = await seedPublishedTemplate(prisma, { code: 'B-ENABLED' });
    await seedPublishedTemplate(prisma, { code: 'A-ENABLED' });
    const drafted = await service.create({ code: 'C-DRAFT', name: 'Draft only', category: 'EHS' }, ACTOR);
    const disabled = await seedPublishedTemplate(prisma, { code: 'D-DISABLED' });
    await service.disable(disabled.templateId, ACTOR);
    await service.startDraft(enabled.templateId, ACTOR);

    const enabledTab = await queries.list({ tab: 'enabled' });
    expect(enabledTab.map((t) => t.code)).toEqual(['A-ENABLED', 'B-ENABLED']);
    expect(enabledTab[1]).toMatchObject({
      current: { version: 1, sectionCount: 1, itemCount: 1, criticalCount: 0 },
      draft: { version: 2, revision: 1, source: 'WEB' },
    });

    expect((await queries.list({ tab: 'draft' })).map((t) => t.code)).toEqual(['B-ENABLED', 'C-DRAFT']);
    expect((await queries.list({ tab: 'draft' })).find((t) => t.id === drafted.templateId)?.current).toBeNull();
    expect((await queries.list({ tab: 'disabled' })).map((t) => t.code)).toEqual(['D-DISABLED']);
  });

  it('filters by category and a case-insensitive search on code or name', async () => {
    await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    await service.create({ code: 'EHS-1', name: 'Tower climb', category: 'EHS' }, ACTOR);
    expect((await queries.list({ tab: 'draft', category: 'EHS' })).map((t) => t.code)).toEqual(['EHS-1']);
    expect((await queries.list({ tab: 'enabled', q: 'antenna' })).map((t) => t.code)).toEqual(['AI-RRU']);
    expect((await queries.list({ tab: 'enabled', q: 'ai-r' })).map((t) => t.code)).toEqual(['AI-RRU']);
  });
});

describe('get and getVersion', () => {
  it('returns versions newest first', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    const detail = await queries.get(templateId);
    expect(detail.versions.map((v) => [v.version, v.status])).toEqual([[2, 'DRAFT'], [1, 'PUBLISHED']]);
  });

  it('returns a version with its ordered tree', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const { template, version } = await queries.getVersion(templateId, 1);
    expect(template.code).toBe('AI-RRU');
    expect(version.sections[0]!.items[0]!.number).toBe('1.1');
  });

  it('answers 404 for an unknown version', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(queries.getVersion(templateId, 9)).rejects.toThrow('Template version not found');
  });
});

describe('currentTree', () => {
  it('returns the published version, or null for the version when nothing is published', async () => {
    const published = await seedPublishedTemplate(prisma);
    expect((await queries.currentTree(published.templateId))?.version?.id).toBe(published.versionId);
    const drafted = await service.create({ code: 'NEW', name: 'New', category: 'OTHER' }, ACTOR);
    expect((await queries.currentTree(drafted.templateId))?.version).toBeNull();
  });
});
