import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateService } from '../src/templates/template.service.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: TemplateService;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new TemplateService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const META = { code: 'AI-RRU', name: 'Antenna + RRU', category: 'QUALITY' as const };
const DOC = { sections: [{ number: '1', title: 'EHS', items: [{ number: '1.1', requirementText: 'PPE worn', severity: 'NORMAL' as const, responseType: 'RESULT_ONLY' as const, selectOptions: [], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true }] }] };

describe('publish', () => {
  it('publishes a first version and points the template at it', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await service.saveDraft(templateId, { revision: 1, document: DOC });
    const published = await service.publish(templateId, ACTOR);
    expect(published).toMatchObject({ version: 1, status: 'PUBLISHED', publishedBy: ACTOR });
    const template = await prisma.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.currentVersionId).toBe(published.id);
  });

  it('retires the previous version', async () => {
    const { templateId, versionId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    const published = await service.publish(templateId, ACTOR);
    const previous = await prisma.templateVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(previous.status).toBe('RETIRED');
    expect(previous.retiredAt).toBeInstanceOf(Date);
    expect(published.version).toBe(2);
    const events = await prisma.outboxEvent.findMany();
    expect(events.map((e) => e.payload)).toContainEqual(expect.objectContaining({
      action: 'qc_template.published', previousState: { version: 1 }, newState: { version: 2 },
    }));
  });

  it('refuses an incomplete draft with a validation error', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.publish(templateId, ACTOR)).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses when there is no draft', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(service.publish(templateId, ACTOR)).rejects.toThrow('This template has no draft');
  });

  it('refuses while disabled', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    await service.disable(templateId, ACTOR);
    await expect(service.publish(templateId, ACTOR)).rejects.toThrow('Enable this template before publishing');
  });

  it('leaves exactly one published version when two publishes race', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    await Promise.allSettled([service.publish(templateId, ACTOR), service.publish(templateId, ACTOR)]);
    expect(await prisma.templateVersion.count({ where: { templateId, status: 'PUBLISHED' } })).toBe(1);
    expect(await prisma.templateVersion.count({ where: { templateId, status: 'RETIRED' } })).toBe(1);
  });
});

describe('disable and enable', () => {
  it('disables and re-enables a published template', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    expect((await service.disable(templateId, ACTOR)).disabledAt).toBeInstanceOf(Date);
    expect((await service.enable(templateId, ACTOR)).disabledAt).toBeNull();
    const actions = (await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => (e.payload as { action: string }).action);
    expect(actions).toEqual(['qc_template.disabled', 'qc_template.enabled']);
  });

  it('refuses to disable a template never published', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.disable(templateId, ACTOR)).rejects.toThrow('Only a published template can be disabled');
  });

  it('refuses to enable a template that is not disabled', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(service.enable(templateId, ACTOR)).rejects.toThrow('This template is not disabled');
  });
});
