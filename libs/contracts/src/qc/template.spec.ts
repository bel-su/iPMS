import { describe, expect, it } from 'vitest';
import {
  CreateTemplateSchema, ImportCommitSchema, ListTemplatesQuerySchema, PublishableDocumentSchema,
  SaveDraftSchema, TemplateDocumentSchema, UpdateTemplateSchema,
} from './template.js';

const item = (over: Record<string, unknown> = {}) => ({ number: '1.1', requirementText: 'PPE worn', ...over });
const doc = (items: unknown[] = [item()]) => ({ sections: [{ number: '1', title: 'EHS', items }] });

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('TemplateDocumentSchema — save rules', () => {
  it('applies item defaults', () => {
    const parsed = TemplateDocumentSchema.parse(doc());
    expect(parsed.sections[0]!.items[0]).toEqual({
      number: '1.1', requirementText: 'PPE worn', severity: 'NORMAL', responseType: 'RESULT_ONLY',
      selectOptions: [], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true,
    });
  });

  it('accepts an empty document and an empty section, so a half-built draft can be saved', () => {
    expect(TemplateDocumentSchema.safeParse({ sections: [] }).success).toBe(true);
    expect(TemplateDocumentSchema.safeParse(doc([])).success).toBe(true);
  });

  it('refuses max photos below min photos, at the item field', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ minPhotos: 2, maxPhotos: 1 })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.maxPhotos']);
  });

  it('needs 2 to 50 options on a Select item', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ responseType: 'SELECT', selectOptions: ['Pole'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses duplicate options case-insensitively', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ responseType: 'SELECT', selectOptions: ['Pole', 'pole'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses an option containing the Excel separator', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ responseType: 'SELECT', selectOptions: ['Pole; Wall', 'Tower'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses options on an item that is not a Select', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ selectOptions: ['A', 'B'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses a section number used twice', () => {
    const result = TemplateDocumentSchema.safeParse({
      sections: [{ number: '1', title: 'A', items: [] }, { number: '1', title: 'B', items: [] }],
    });
    expect(issuePaths(result)).toEqual(['sections.1.number']);
  });

  it('refuses an item number used twice within its section', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item(), item()]));
    expect(issuePaths(result)).toEqual(['sections.0.items.1.number']);
  });

  it('allows the same item number in different sections', () => {
    const result = TemplateDocumentSchema.safeParse({
      sections: [{ number: '1', title: 'A', items: [item()] }, { number: '2', title: 'B', items: [item()] }],
    });
    expect(result.success).toBe(true);
  });

  it('refuses more than 1,000 items in total', () => {
    const many = Array.from({ length: 501 }, (_, i) => item({ number: String(i) }));
    const result = TemplateDocumentSchema.safeParse({
      sections: [{ number: '1', title: 'A', items: many }, { number: '2', title: 'B', items: many }],
    });
    expect(issuePaths(result)).toEqual(['sections']);
  });
});

describe('PublishableDocumentSchema — publish rules', () => {
  it('needs at least one section', () => {
    expect(issuePaths(PublishableDocumentSchema.safeParse({ sections: [] }))).toEqual(['sections']);
  });

  it('needs an item in every section', () => {
    expect(issuePaths(PublishableDocumentSchema.safeParse(doc([])))).toEqual(['sections.0.items']);
  });

  it('still applies the save rules', () => {
    const result = PublishableDocumentSchema.safeParse(doc([item({ minPhotos: 3, maxPhotos: 0 })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.maxPhotos']);
  });
});

describe('request schemas', () => {
  it('upper-case codes only', () => {
    expect(CreateTemplateSchema.safeParse({ code: 'ai-rru', name: 'X', category: 'QUALITY' }).success).toBe(false);
    expect(CreateTemplateSchema.parse({ code: 'AI-RRU_1', name: ' Antenna ', category: 'EHS' }))
      .toEqual({ code: 'AI-RRU_1', name: 'Antenna', category: 'EHS' });
  });

  it('an update must change something', () => {
    expect(UpdateTemplateSchema.safeParse({}).success).toBe(false);
    expect(UpdateTemplateSchema.parse({ name: 'New' })).toEqual({ name: 'New' });
  });

  it('a draft save carries a revision', () => {
    expect(SaveDraftSchema.safeParse({ document: { sections: [] } }).success).toBe(false);
    expect(SaveDraftSchema.parse({ revision: 3, document: { sections: [] } }).revision).toBe(3);
  });

  it('an import commit must be publishable', () => {
    expect(ImportCommitSchema.safeParse({ code: 'A', name: 'A', category: 'QUALITY', document: { sections: [] } }).success).toBe(false);
  });

  it('the list defaults to the enabled tab', () => {
    expect(ListTemplatesQuerySchema.parse({})).toEqual({ tab: 'enabled' });
  });
});
