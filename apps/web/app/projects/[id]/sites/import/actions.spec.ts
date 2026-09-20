import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }) }));

const previewSiteImport = vi.fn();
const commitSiteImport = vi.fn();
vi.mock('../../../../lib/project-api', () => ({ previewSiteImport, commitSiteImport }));

const { previewImportAction, commitImportAction } = await import('./actions');

const PROJECT_ID = '0192f7a0-0000-7000-8000-000000000001';

beforeEach(() => { vi.clearAllMocks(); });

describe('previewImportAction', () => {
  it('rejects a submission with no file', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    expect((await previewImportAction({}, form)).error).toContain('Choose a .xlsx file');
    expect(previewSiteImport).not.toHaveBeenCalled();
  });

  it('returns the preview on success', async () => {
    const preview = {
      columns: ['site_code'],
      summary: { created: 1, updated: 0, invalid: 0 },
      rows: [],
      importable: { columns: ['site_code'], rows: [] },
    };
    previewSiteImport.mockResolvedValue({ state: 'ready', data: preview });
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('file', new File(['x'], 'sites.xlsx'));
    expect((await previewImportAction({}, form)).preview).toEqual(preview);
  });
});

describe('commitImportAction', () => {
  // All-or-nothing: with an invalid row there is nothing to confirm, and the
  // button that would send this is not rendered.
  it('refuses to commit when the preview had no importable payload', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('payload', 'null');
    expect((await commitImportAction({}, form)).error).toContain('Fix the file');
    expect(commitSiteImport).not.toHaveBeenCalled();
  });

  it('reports the counts on success', async () => {
    commitSiteImport.mockResolvedValue({ state: 'ready', data: { created: 3, updated: 2 } });
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('payload', JSON.stringify({ columns: ['site_code'], rows: [] }));
    expect((await commitImportAction({}, form)).committed).toEqual({ created: 3, updated: 2 });
  });
});
