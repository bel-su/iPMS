import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); });
vi.mock('next/navigation', () => ({ redirect }));

const qc = { createTemplate: vi.fn(), updateTemplate: vi.fn(), startDraft: vi.fn(), disableTemplate: vi.fn(), enableTemplate: vi.fn() };
vi.mock('../../lib/qc-api', () => qc);

const actions = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('createTemplateAction', () => {
  it('upper-cases the code and opens the new draft', async () => {
    qc.createTemplate.mockResolvedValue({ state: 'ready', data: { templateId: ID, draft: {} } });
    await expect(actions.createTemplateAction({}, form({ code: 'ai-rru', name: 'Antenna', category: 'QUALITY' })))
      .rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}/draft`);
    expect(qc.createTemplate).toHaveBeenCalledWith({ code: 'AI-RRU', name: 'Antenna', category: 'QUALITY' });
  });

  it('asks for every field before calling the API', async () => {
    expect((await actions.createTemplateAction({}, form({ code: 'A', name: '' , category: 'QUALITY' }))).error).toContain('required');
    expect(qc.createTemplate).not.toHaveBeenCalled();
  });

  it('shows the service message on a conflict', async () => {
    qc.createTemplate.mockResolvedValue({ state: 'unavailable', status: 409, message: 'A template with code A already exists' });
    expect((await actions.createTemplateAction({}, form({ code: 'A', name: 'A', category: 'EHS' }))).error).toBe('A template with code A already exists');
  });
});

describe('renameTemplateAction', () => {
  it('sends only the fields given', async () => {
    qc.updateTemplate.mockResolvedValue({ state: 'ready', data: {} });
    expect(await actions.renameTemplateAction({}, form({ templateId: ID, name: 'New name' }))).toEqual({});
    expect(qc.updateTemplate).toHaveBeenCalledWith(ID, { name: 'New name' });
  });
});

describe('startDraftAction', () => {
  it('opens the new draft', async () => {
    qc.startDraft.mockResolvedValue({ state: 'ready', data: { templateId: ID, draft: {} } });
    await expect(actions.startDraftAction({}, form({ templateId: ID }))).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}/draft`);
  });
});

describe('disable and enable', () => {
  it('report the service message', async () => {
    qc.disableTemplate.mockResolvedValue({ state: 'unavailable', status: 409, message: 'Only a published template can be disabled' });
    expect((await actions.disableTemplateAction({}, form({ templateId: ID }))).error).toBe('Only a published template can be disabled');
    qc.enableTemplate.mockResolvedValue({ state: 'ready', data: {} });
    expect(await actions.enableTemplateAction({}, form({ templateId: ID }))).toEqual({});
  });
});
