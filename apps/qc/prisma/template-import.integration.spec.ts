import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateImportService } from '../src/templates/template-import.service.js';
import { TemplateService } from '../src/templates/template.service.js';
import { EXAMPLE_DOCUMENT, buildWorkbook } from '../src/templates/excel/workbook.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let templates: TemplateService;
let imports: TemplateImportService;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  templates = new TemplateService(prisma);
  imports = new TemplateImportService(prisma, templates);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const file = (code: string, name = 'Antenna + RRU') =>
  buildWorkbook({ metadata: { code, name, category: 'QUALITY' }, version: null, document: EXAMPLE_DOCUMENT });

describe('preview', () => {
  it('targets a new template and summarizes the document, writing nothing', async () => {
    const preview = await imports.preview(await file('NEW-1'));
    expect(preview.target).toEqual({ kind: 'NEW' });
    expect(preview.summary).toEqual({ sections: 2, items: 5, critical: 1, withPhotos: 3 });
    expect(await prisma.checklistTemplate.count()).toBe(0);
  });

  it('targets the next version of an existing template and warns about differences', async () => {
    const { templateId } = await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    const preview = await imports.preview(await file('AI-RRU', 'Different name'));
    expect(preview.target).toMatchObject({ kind: 'EXISTING', templateId, replacesDraft: null, nextVersion: 2 });
    expect(preview.warnings[0]).toContain('An import never renames a template');
  });

  it('warns that an existing draft will be replaced', async () => {
    const { templateId } = await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    await templates.startDraft(templateId, ACTOR);
    const preview = await imports.preview(await file('AI-RRU'));
    expect(preview.target).toMatchObject({ replacesDraft: { version: 2, revision: 1 }, nextVersion: 2 });
    expect(preview.warnings).toContain('This replaces the current v2 draft.');
  });

  it('returns row errors and no document for a broken file', async () => {
    const preview = await imports.preview(Buffer.from('nope'));
    expect(preview.document).toBeNull();
    expect(preview.errors).toHaveLength(1);
  });
});

describe('commit', () => {
  it('creates a new template from the file', async () => {
    const created = await imports.commit({ code: 'NEW-1', name: 'New', category: 'EHS', document: EXAMPLE_DOCUMENT }, ACTOR);
    expect(created.draft).toMatchObject({ version: 1, source: 'EXCEL_IMPORT' });
  });

  it('replaces an existing draft only at the previewed revision', async () => {
    const { templateId } = await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    await templates.startDraft(templateId, ACTOR);
    const dto = { code: 'AI-RRU', name: 'x', category: 'QUALITY' as const, document: EXAMPLE_DOCUMENT };
    await expect(imports.commit({ ...dto, expectedDraftRevision: 7 }, ACTOR)).rejects.toThrow('Preview the file again');
    const created = await imports.commit({ ...dto, expectedDraftRevision: 1 }, ACTOR);
    expect(created).toMatchObject({ templateId, draft: { version: 2, revision: 2, source: 'EXCEL_IMPORT' } });
  });
});
