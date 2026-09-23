import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); }) }));

const previewTemplateImport = vi.fn();
const commitTemplateImport = vi.fn();
vi.mock('../../../lib/qc-api', () => ({ previewTemplateImport, commitTemplateImport }));

const { previewTemplateImportAction, commitTemplateImportAction } = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';

beforeEach(() => { vi.clearAllMocks(); });

describe('previewTemplateImportAction', () => {
  it('asks for a file', async () => {
    expect((await previewTemplateImportAction({}, new FormData())).error).toContain('Choose a .xlsx file');
    expect(previewTemplateImport).not.toHaveBeenCalled();
  });

  it('returns the preview', async () => {
    const preview = { metadata: null, target: null, warnings: [], errors: [{ row: 2, column: 'Code', message: 'x' }], document: null, summary: null };
    previewTemplateImport.mockResolvedValue({ state: 'ready', data: preview });
    const form = new FormData();
    form.set('file', new File(['x'], 'c.xlsx'));
    expect((await previewTemplateImportAction({}, form)).preview).toEqual(preview);
  });
});

describe('commitTemplateImportAction', () => {
  it('refuses a payload that is not JSON', async () => {
    const form = new FormData();
    form.set('payload', 'not json');
    expect((await commitTemplateImportAction({}, form)).error).toContain('Preview the file again');
    expect(commitTemplateImport).not.toHaveBeenCalled();
  });

  it('commits and opens the draft', async () => {
    commitTemplateImport.mockResolvedValue({ state: 'ready', data: { templateId: ID, draft: {} } });
    const form = new FormData();
    form.set('payload', JSON.stringify({ code: 'A', name: 'A', category: 'QUALITY', document: { sections: [] } }));
    await expect(commitTemplateImportAction({}, form)).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}/draft`);
  });
});
