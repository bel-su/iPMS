import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateDocumentSchema, type TemplateDocument } from '@ipms/contracts';
import { TemplateService } from '../src/templates/template.service.js';
import { TREE_INCLUDE, toDocument } from '../src/templates/document.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: TemplateService;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new TemplateService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const META = { code: 'AI-RRU', name: 'Antenna + RRU', category: 'QUALITY' as const };
const DOC: TemplateDocument = TemplateDocumentSchema.parse({
  sections: [
    { number: '1', title: 'EHS', items: [
      { number: '1.1', requirementText: 'PPE worn', severity: 'CRITICAL', minPhotos: 1, maxPhotos: 3, guidanceText: 'Helmet visible' },
      { number: '1.2', requirementText: 'Mount type', responseType: 'SELECT', selectOptions: ['Pole', 'Wall'] },
    ] },
    { number: '2', title: 'Antenna', items: [{ number: '2.1', requirementText: 'Azimuth', responseType: 'NUMBER', allowsNa: true }] },
  ],
});

async function draftDocument(templateId: string): Promise<TemplateDocument> {
  const draft = await prisma.templateVersion.findFirstOrThrow({ where: { templateId, status: 'DRAFT' }, include: TREE_INCLUDE });
  return toDocument(draft);
}

const auditActions = async () => (await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } }))
  .map((row) => (row.payload as { action: string }).action);

describe('create', () => {
  it('makes a template with an empty v1 draft and audits it', async () => {
    const created = await service.create(META, ACTOR);
    expect(created.draft).toMatchObject({ version: 1, revision: 1, source: 'WEB' });
    expect(await draftDocument(created.templateId)).toEqual({ sections: [] });
    expect(await auditActions()).toEqual(['qc_template.created']);
  });

  it('refuses a code that exists', async () => {
    await service.create(META, ACTOR);
    await expect(service.create(META, ACTOR)).rejects.toThrow('A template with code AI-RRU already exists');
  });
});

describe('saveDraft', () => {
  it('replaces the whole tree and bumps the revision', async () => {
    const { templateId } = await service.create(META, ACTOR);
    const saved = await service.saveDraft(templateId, { revision: 1, document: DOC });
    expect(saved.revision).toBe(2);
    expect(await draftDocument(templateId)).toEqual(DOC);
  });

  it('refuses a stale revision and leaves the draft untouched', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await service.saveDraft(templateId, { revision: 1, document: DOC });
    await expect(service.saveDraft(templateId, { revision: 1, document: { sections: [] } }))
      .rejects.toThrow('Someone else saved this draft');
    expect(await draftDocument(templateId)).toEqual(DOC);
  });

  it('lets exactly one of two concurrent saves at the same revision win', async () => {
    const { templateId } = await service.create(META, ACTOR);
    const results = await Promise.allSettled([
      service.saveDraft(templateId, { revision: 1, document: DOC }),
      service.saveDraft(templateId, { revision: 1, document: { sections: [] } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('answers 409 when there is no draft', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(service.saveDraft(templateId, { revision: 1, document: DOC })).rejects.toThrow('This template has no draft');
  });
});

describe('startDraft', () => {
  it('clones the published version as the next version', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const created = await service.startDraft(templateId, ACTOR);
    expect(created.draft).toMatchObject({ version: 2, revision: 1 });
    expect((await draftDocument(templateId)).sections[0]!.items[0]!.requirementText).toBe('PPE worn');
  });

  it('refuses when a draft already exists', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    await expect(service.startDraft(templateId, ACTOR)).rejects.toThrow('A draft (v2) already exists');
  });

  it('refuses when nothing is published', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.startDraft(templateId, ACTOR)).rejects.toThrow('A draft (v1) already exists');
  });

  it('lets exactly one of two concurrent starts win', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const results = await Promise.allSettled([
      service.startDraft(templateId, ACTOR),
      service.startDraft(templateId, ACTOR),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.templateVersion.count({ where: { templateId, status: 'DRAFT' } })).toBe(1);
  });
});

describe('discardDraft', () => {
  it('deletes a never-published template together with its draft', async () => {
    const { templateId } = await service.create(META, ACTOR);
    expect(await service.discardDraft(templateId, ACTOR)).toEqual({ templateDeleted: true });
    expect(await prisma.checklistTemplate.count()).toBe(0);
  });

  it('keeps a published template and its current version', async () => {
    const { templateId, versionId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    expect(await service.discardDraft(templateId, ACTOR)).toEqual({ templateDeleted: false });
    const template = await prisma.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.currentVersionId).toBe(versionId);
    expect(await auditActions()).toEqual(['qc_template.draft_discarded']);
  });
});

describe('rename', () => {
  it('updates name and category and audits only what changed', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await service.rename(templateId, { name: 'Antenna only' }, ACTOR);
    const events = await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events[1]!.payload).toMatchObject({
      action: 'qc_template.updated', previousState: { name: 'Antenna + RRU' }, newState: { name: 'Antenna only' },
    });
  });
});

describe('importIntoDraft', () => {
  it('creates the next draft from an imported document', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const created = await service.importIntoDraft(templateId, DOC, undefined, ACTOR);
    expect(created.draft).toMatchObject({ version: 2, source: 'EXCEL_IMPORT' });
    expect(await draftDocument(templateId)).toEqual(DOC);
    expect(await auditActions()).toEqual(['qc_template.imported']);
  });

  it('replaces an existing draft only at the previewed revision', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.importIntoDraft(templateId, DOC, undefined, ACTOR)).rejects.toThrow('Preview the file again');
    const created = await service.importIntoDraft(templateId, DOC, 1, ACTOR);
    expect(created.draft).toMatchObject({ version: 1, revision: 2, source: 'EXCEL_IMPORT' });
  });

  it('lets exactly one of two concurrent imports with no existing draft win', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const results = await Promise.allSettled([
      service.importIntoDraft(templateId, DOC, undefined, ACTOR),
      service.importIntoDraft(templateId, DOC, undefined, ACTOR),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.templateVersion.count({ where: { templateId, status: 'DRAFT' } })).toBe(1);
  });
});
