import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const api = await import('./finance-api');

beforeEach(() => { authFetch.mockClear(); });

const INVOICE = { vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1500.50' };
const PAY = { mode: 'BANK_TRANSFER' as const, reference: 'TXN-1', paidOn: '2026-10-05' };

/** Finance is its own service, reached through the gateway's `/api/v1/finance` prefix and nothing else. */
const CALLS: { name: string; call: () => Promise<unknown>; path: string; method?: string; json?: unknown; query?: Record<string, string | undefined> }[] = [
  { name: 'listRequests', call: () => api.listRequests({ view: 'awaiting', page: 2 }), path: '/api/v1/finance/requests', query: { view: 'awaiting', status: undefined, kind: undefined, projectId: undefined, page: '2', limit: undefined } },
  { name: 'getRequest', call: () => api.getRequest('r-1'), path: '/api/v1/finance/requests/r-1' },
  { name: 'getAdvance', call: () => api.getAdvance('a-1'), path: '/api/v1/finance/advances/a-1' },
  { name: 'createRequest', call: () => api.createRequest({ kind: 'REIMBURSEMENT', projectId: 'p-1', categoryId: 'c-1', purpose: 'Fuel', invoices: [INVOICE] }), path: '/api/v1/finance/requests', method: 'POST', json: { kind: 'REIMBURSEMENT', projectId: 'p-1', categoryId: 'c-1', purpose: 'Fuel', invoices: [INVOICE] } },
  { name: 'updateRequest', call: () => api.updateRequest('r-1', { purpose: 'More fuel' }), path: '/api/v1/finance/requests/r-1', method: 'PATCH', json: { purpose: 'More fuel' } },
  { name: 'submitRequest', call: () => api.submitRequest('r-1'), path: '/api/v1/finance/requests/r-1/submit', method: 'POST' },
  { name: 'cancelRequest', call: () => api.cancelRequest('r-1', 'No longer needed'), path: '/api/v1/finance/requests/r-1/cancel', method: 'POST', json: { comment: 'No longer needed' } },
  { name: 'cancelRequest without a reason', call: () => api.cancelRequest('r-1'), path: '/api/v1/finance/requests/r-1/cancel', method: 'POST', json: {} },
  { name: 'approveRequest', call: () => api.approveRequest('r-1', { amount: '40000.00' }), path: '/api/v1/finance/requests/r-1/approve', method: 'POST', json: { amount: '40000.00' } },
  { name: 'returnRequest', call: () => api.returnRequest('r-1', 'Add the quotation'), path: '/api/v1/finance/requests/r-1/return', method: 'POST', json: { comment: 'Add the quotation' } },
  { name: 'rejectRequest', call: () => api.rejectRequest('r-1', 'Not in budget'), path: '/api/v1/finance/requests/r-1/reject', method: 'POST', json: { comment: 'Not in budget' } },
  { name: 'payRequest', call: () => api.payRequest('r-1', PAY), path: '/api/v1/finance/requests/r-1/pay', method: 'POST', json: PAY },
  { name: 'returnCash', call: () => api.returnCash('a-1', { ...PAY, amount: '3000.00' }), path: '/api/v1/finance/advances/a-1/cash-return', method: 'POST', json: { ...PAY, amount: '3000.00' } },
  { name: 'listCategories', call: () => api.listCategories(), path: '/api/v1/finance/categories' },
  { name: 'createCategory', call: () => api.createCategory({ code: 'PERMITS', name: 'Permits' }), path: '/api/v1/finance/categories', method: 'POST', json: { code: 'PERMITS', name: 'Permits' } },
  { name: 'updateCategory', call: () => api.updateCategory('c-1', { disabled: true }), path: '/api/v1/finance/categories/c-1', method: 'PATCH', json: { disabled: true } },
  { name: 'spendReport', call: () => api.spendReport({ groupBy: 'category', from: '2026-10-01' }), path: '/api/v1/finance/reports/project-spend', query: { groupBy: 'category', projectId: undefined, from: '2026-10-01', to: undefined, format: 'json' } },
];

describe('finance-api: every call maps to a finance route', () => {
  for (const { name, call, path, method, json, query } of CALLS) {
    it(`${name} calls ${method ?? 'GET'} ${path}`, async () => {
      await call();
      const [actualPath, request] = authFetch.mock.calls[0]!;
      expect(actualPath).toBe(path);
      expect(request?.method).toBe(method);
      expect(request?.json).toEqual(json);
      if (query) expect(request?.query).toEqual(query);
    });
  }
});
