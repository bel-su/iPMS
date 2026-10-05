import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const ready = (data: unknown = {}) => ({ state: 'ready' as const, data });
const api = {
  createRequest: vi.fn(), updateRequest: vi.fn(), submitRequest: vi.fn(), cancelRequest: vi.fn(),
  approveRequest: vi.fn(), returnRequest: vi.fn(), rejectRequest: vi.fn(), payRequest: vi.fn(), returnCash: vi.fn(),
  createCategory: vi.fn(), updateCategory: vi.fn(),
};
vi.mock('../lib/finance-api', () => api);

const actions = await import('./actions');
const EMPTY = {};
const form = (entries: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
  return data;
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue(ready({ id: 'r-1' }));
  revalidatePath.mockClear(); redirect.mockClear();
});

describe('saveRequestAction', () => {
  const advance = { kind: 'ADVANCE', projectId: 'p-1', categoryId: 'c-1', purpose: 'Site travel', amount: '50,000' };

  it('creates an advance as a draft and opens it', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'draft' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-1');
    expect(api.createRequest).toHaveBeenCalledWith({ kind: 'ADVANCE', projectId: 'p-1', categoryId: 'c-1', purpose: 'Site travel', amount: '50000.00' });
    expect(api.submitRequest).not.toHaveBeenCalled();
  });

  it('submits straight away when asked to', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'submit' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-1');
    expect(api.submitRequest).toHaveBeenCalledWith('r-1');
  });

  it('creates a settlement against an advance from its invoice rows', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({
      kind: 'SETTLEMENT', advanceId: 'a-1', categoryId: 'c-1', purpose: 'Bills', intent: 'draft',
      invoiceVendor: ['V'], invoiceNumber: ['I-1'], invoiceDate: ['2026-10-01'], invoiceAmount: ['1,200'],
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.createRequest).toHaveBeenCalledWith({
      kind: 'SETTLEMENT', advanceId: 'a-1', categoryId: 'c-1', purpose: 'Bills',
      invoices: [{ vendor: 'V', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1200.00' }],
    });
  });

  it('updates an existing request instead of creating one', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, id: 'r-9', intent: 'draft' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-9');
    expect(api.updateRequest).toHaveBeenCalledWith('r-9', { categoryId: 'c-1', purpose: 'Site travel', amount: '50000.00' });
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('explains what is missing instead of calling the API', async () => {
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, amount: 'abc', intent: 'draft' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, purpose: '  ', intent: 'draft' }))).toEqual({ error: 'Say what the money is for.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, categoryId: '', intent: 'draft' }))).toEqual({ error: 'Choose a category.' });
    expect(await actions.saveRequestAction(EMPTY, form({ kind: 'REIMBURSEMENT', projectId: 'p-1', categoryId: 'c-1', purpose: 'Fuel', intent: 'draft' }))).toEqual({ error: 'Add at least one invoice.' });
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('shows the service message when it refuses', async () => {
    api.createRequest.mockResolvedValue({ state: 'forbidden', message: 'You do not have access to this project' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'draft' }))).toEqual({ error: 'You do not have access to this project' });
  });
});

describe('request actions', () => {
  it('submits and cancels, refreshing the workspace and the request page', async () => {
    expect(await actions.submitAction(EMPTY, form({ id: 'r-1' }))).toEqual(EMPTY);
    expect(api.submitRequest).toHaveBeenCalledWith('r-1');
    expect(revalidatePath).toHaveBeenCalledWith('/finance');
    expect(revalidatePath).toHaveBeenCalledWith('/finance/requests/r-1');
    await actions.cancelAction(EMPTY, form({ id: 'r-1', comment: 'Not needed' }));
    expect(api.cancelRequest).toHaveBeenCalledWith('r-1', 'Not needed');
  });

  it('approves, with an amount only when one was typed', async () => {
    await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '40,000', comment: 'Cut travel days' }));
    expect(api.approveRequest).toHaveBeenCalledWith('r-1', { amount: '40000.00', comment: 'Cut travel days' });
    await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '', comment: '' }));
    expect(api.approveRequest).toHaveBeenLastCalledWith('r-1', {});
    expect(await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '1.234' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
  });

  it('requires a reason to return or reject', async () => {
    expect(await actions.returnAction(EMPTY, form({ id: 'r-1', comment: '  ' }))).toEqual({ error: 'Say why.' });
    expect(await actions.rejectAction(EMPTY, form({ id: 'r-1', comment: '' }))).toEqual({ error: 'Say why.' });
    expect(api.returnRequest).not.toHaveBeenCalled();
    await actions.returnAction(EMPTY, form({ id: 'r-1', comment: 'Add the quotation' }));
    expect(api.returnRequest).toHaveBeenCalledWith('r-1', 'Add the quotation');
    await actions.rejectAction(EMPTY, form({ id: 'r-1', comment: 'Not in budget' }));
    expect(api.rejectRequest).toHaveBeenCalledWith('r-1', 'Not in budget');
  });
});

describe('payment actions', () => {
  it('pays with the payment details', async () => {
    await actions.payAction(EMPTY, form({ id: 'r-1', mode: 'BANK_TRANSFER', reference: 'TXN-1', paidOn: '2026-10-05', note: 'NIC Asia' }));
    expect(api.payRequest).toHaveBeenCalledWith('r-1', { mode: 'BANK_TRANSFER', reference: 'TXN-1', paidOn: '2026-10-05', note: 'NIC Asia' });
  });

  it('sends nothing for blank details so a settlement without a payout can be confirmed', async () => {
    await actions.payAction(EMPTY, form({ id: 's-1', mode: '', reference: '', paidOn: '', note: '' }));
    expect(api.payRequest).toHaveBeenCalledWith('s-1', {});
  });

  it('refuses a payment mode it does not know', async () => {
    expect(await actions.payAction(EMPTY, form({ id: 'r-1', mode: 'BITCOIN', reference: 'x', paidOn: '2026-10-05' }))).toEqual({ error: 'Choose how it was paid.' });
  });

  it('records returned cash against an advance', async () => {
    await actions.cashReturnAction(EMPTY, form({ id: 'a-1', amount: '3,000', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' }));
    expect(api.returnCash).toHaveBeenCalledWith('a-1', { amount: '3000.00', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' });
    expect(await actions.cashReturnAction(EMPTY, form({ id: 'a-1', amount: '', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
  });
});

describe('category actions', () => {
  it('creates a category from an upper-cased code and renames or disables one', async () => {
    await actions.createCategoryAction(EMPTY, form({ code: 'permits', name: 'Permits' }));
    expect(api.createCategory).toHaveBeenCalledWith({ code: 'PERMITS', name: 'Permits' });
    expect(revalidatePath).toHaveBeenCalledWith('/finance/categories');
    await actions.updateCategoryAction(EMPTY, form({ id: 'c-1', disabled: 'true' }));
    expect(api.updateCategory).toHaveBeenCalledWith('c-1', { disabled: true });
    await actions.updateCategoryAction(EMPTY, form({ id: 'c-1', name: 'Permits and fees' }));
    expect(api.updateCategory).toHaveBeenLastCalledWith('c-1', { name: 'Permits and fees' });
  });
});
