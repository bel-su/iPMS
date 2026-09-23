import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const api = await import('./qc-api');

beforeEach(() => { authFetch.mockClear(); });

describe('qc-api — every call maps to a gateway route', () => {
  it('lists a tab, dropping empty filters', async () => {
    await api.listTemplates({ tab: 'draft', category: undefined, q: undefined });
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/templates', { query: { tab: 'draft', category: undefined, q: undefined } }]);
  });

  it('reads a template and a version', async () => {
    await api.getTemplate('t-1');
    await api.getVersion('t-1', 3);
    expect(authFetch.mock.calls.map((call) => call[0])).toEqual(['/api/v1/qc/templates/t-1', '/api/v1/qc/templates/t-1/versions/3']);
  });

  it('creates and renames', async () => {
    await api.createTemplate({ code: 'A', name: 'A', category: 'EHS' });
    await api.updateTemplate('t-1', { name: 'B' });
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/templates', { method: 'POST', json: { code: 'A', name: 'A', category: 'EHS' } }]);
    expect(authFetch.mock.calls[1]).toEqual(['/api/v1/qc/templates/t-1', { method: 'PATCH', json: { name: 'B' } }]);
  });

  it('drives the draft lifecycle', async () => {
    const body = { revision: 2, document: { sections: [] } };
    await api.startDraft('t-1');
    await api.saveDraft('t-1', body);
    await api.discardDraft('t-1');
    await api.publishTemplate('t-1');
    await api.disableTemplate('t-1');
    await api.enableTemplate('t-1');
    expect(authFetch.mock.calls).toEqual([
      ['/api/v1/qc/templates/t-1/draft', { method: 'POST' }],
      ['/api/v1/qc/templates/t-1/draft', { method: 'PUT', json: body }],
      ['/api/v1/qc/templates/t-1/draft', { method: 'DELETE' }],
      ['/api/v1/qc/templates/t-1/publish', { method: 'POST' }],
      ['/api/v1/qc/templates/t-1/disable', { method: 'POST' }],
      ['/api/v1/qc/templates/t-1/enable', { method: 'POST' }],
    ]);
  });

  it('uploads an import as multipart and commits it as JSON', async () => {
    const file = new File(['x'], 'checklist.xlsx');
    await api.previewTemplateImport(file);
    const [path, request] = authFetch.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(path).toBe('/api/v1/qc/templates/import/preview');
    expect(request.method).toBe('POST');
    expect(request.body.get('file')).toBeInstanceOf(File);
    const dto = { code: 'A', name: 'A', category: 'QUALITY' as const, document: { sections: [] } };
    await api.commitTemplateImport(dto);
    expect(authFetch.mock.calls[1]).toEqual(['/api/v1/qc/templates/import/commit', { method: 'POST', json: dto }]);
  });

  it('keeps the submission calls', async () => {
    await api.getSubmission('s-1');
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/submissions/s-1']);
  });
});
