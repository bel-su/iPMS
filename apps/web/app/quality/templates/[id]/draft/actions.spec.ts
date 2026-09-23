import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); }) }));

const qc = { saveDraft: vi.fn(), publishTemplate: vi.fn(), discardDraft: vi.fn() };
vi.mock('../../../../lib/qc-api', () => qc);

const { saveDraftAction, publishDraftAction, discardDraftAction } = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';
const DOC = { sections: [] };

beforeEach(() => { vi.clearAllMocks(); });

describe('saveDraftAction', () => {
  it('returns the new revision', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'ready', data: { revision: 4 } });
    expect(await saveDraftAction(ID, 3, DOC)).toEqual({ revision: 4, error: null, fieldErrors: {}, conflict: false });
    expect(qc.saveDraft).toHaveBeenCalledWith(ID, { revision: 3, document: DOC });
  });

  it('maps validation details to editor fields', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'unavailable', status: 422, message: 'Request validation failed', details: { 'document.sections.0.title': 'Required' } });
    expect(await saveDraftAction(ID, 3, DOC)).toEqual({ revision: null, error: 'Request validation failed', fieldErrors: { 'sections.0.title': 'Required' }, conflict: false });
  });

  it('flags a stale revision as a conflict', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'unavailable', status: 409, message: 'Someone else saved this draft.' });
    expect((await saveDraftAction(ID, 3, DOC)).conflict).toBe(true);
  });
});

describe('publishDraftAction', () => {
  it('saves, publishes and opens the template', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'ready', data: { revision: 4 } });
    qc.publishTemplate.mockResolvedValue({ state: 'ready', data: {} });
    await expect(publishDraftAction(ID, 3, DOC)).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}`);
  });

  it('keeps the saved revision when publishing is refused', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'ready', data: { revision: 4 } });
    qc.publishTemplate.mockResolvedValue({ state: 'unavailable', status: 422, message: 'Request validation failed', details: { 'sections.1.items': 'Every section needs at least one item' } });
    expect(await publishDraftAction(ID, 3, DOC)).toEqual({
      revision: 4, error: 'Request validation failed', fieldErrors: { 'sections.1.items': 'Every section needs at least one item' }, conflict: false,
    });
  });

  it('does not publish when the save fails', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'unavailable', status: 409, message: 'stale' });
    await publishDraftAction(ID, 3, DOC);
    expect(qc.publishTemplate).not.toHaveBeenCalled();
  });
});

describe('discardDraftAction', () => {
  it('goes back to the list when the template went with its draft', async () => {
    qc.discardDraft.mockResolvedValue({ state: 'ready', data: { templateDeleted: true } });
    await expect(discardDraftAction(ID)).rejects.toThrow('NEXT_REDIRECT /quality/templates?tab=draft');
  });

  it('goes back to the template otherwise', async () => {
    qc.discardDraft.mockResolvedValue({ state: 'ready', data: { templateDeleted: false } });
    await expect(discardDraftAction(ID)).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}`);
  });
});
