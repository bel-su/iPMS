import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const api = await import('./qc-api');

const TEMPLATE = {
  projectId: 'p-1', code: 'QC-1', name: 'Civil works', category: 'QUALITY' as const,
  sections: [{ number: '1', title: 'Foundations', order: 0, items: [] as never[] }],
};

const SUBMISSION = {
  taskId: 't-1', siteId: 's-1', projectId: 'p-1', templateId: 'tpl-1',
  idempotencyKey: 'key-12345678', responses: [] as never[],
};

beforeEach(() => { authFetch.mockClear(); });

describe('qc-api — every call maps to a gateway route', () => {
  it('lists templates for one project by query', async () => {
    await api.listTemplates('p-1');
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/templates', { query: { projectId: 'p-1' } }]);
  });

  // The service treats a missing projectId as "every template in scope"; the
  // client must send no parameter rather than the string 'undefined'.
  it('omits the project filter when none is given', async () => {
    await api.listTemplates();
    expect(authFetch.mock.calls[0]![1]).toEqual({ query: { projectId: undefined } });
  });

  it('creates a template', async () => {
    await api.createTemplate(TEMPLATE);
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/templates', { method: 'POST', json: TEMPLATE }]);
  });

  it('publishes a template with no body', async () => {
    await api.publishTemplate('tpl-1');
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/templates/tpl-1/publish', { method: 'POST' }]);
  });

  it('reads one submission', async () => {
    await api.getSubmission('sub-1');
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/submissions/sub-1']);
  });

  it('creates a submission', async () => {
    await api.createSubmission(SUBMISSION);
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/submissions', { method: 'POST', json: SUBMISSION }]);
  });

  it('reviews a submission', async () => {
    const review = { decision: 'APPROVE' as const, itemReviews: [{ itemId: 'i-1', result: 'APPROVED' as const }] };
    await api.reviewSubmission('sub-1', review);
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/submissions/sub-1/review', { method: 'POST', json: review }]);
  });

  it('stays inside the gateway’s qc prefix', async () => {
    const calls = [
      () => api.listTemplates('p-1'), () => api.createTemplate(TEMPLATE), () => api.publishTemplate('tpl-1'),
      () => api.getSubmission('sub-1'), () => api.createSubmission(SUBMISSION),
      () => api.reviewSubmission('sub-1', { decision: 'APPROVE', itemReviews: [{ itemId: 'i-1', result: 'APPROVED' }] }),
    ];
    for (const call of calls) {
      authFetch.mockClear();
      await call();
      expect(authFetch.mock.calls[0]![0] as string).toMatch(/^\/api\/v1\/qc\//);
    }
  });
});
