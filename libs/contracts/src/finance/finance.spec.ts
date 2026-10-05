import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../common/ids.js';
import {
  ApproveSchema, CashReturnSchema, CommentSchema, CreateRequestSchema, ListRequestsQuerySchema, MoneySchema,
  PayRequestSchema, PaymentDetailsSchema,
} from './finance.js';

const invoice = { vendor: 'Himal Fuel', invoiceNumber: 'INV-1', invoiceDate: '2026-10-01', amount: '1500.50', mediaId: uuidv7() };

describe('MoneySchema', () => {
  it.each(['1', '10.5', '1500.50', '0.01'])('accepts %s', (v) => expect(MoneySchema.safeParse(v).success).toBe(true));
  it.each(['0', '0.00', '-5', '1.234', 'abc', '1e3', '', '1,000'])('rejects %s', (v) => expect(MoneySchema.safeParse(v).success).toBe(false));
});

describe('CreateRequestSchema', () => {
  const base = { categoryId: uuidv7(), purpose: 'Site travel' };

  it('takes an advance with an amount and no invoices', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'ADVANCE', projectId: uuidv7(), amount: '50000' }).success).toBe(true);
  });

  it('refuses an advance with no amount', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'ADVANCE', projectId: uuidv7() }).success).toBe(false);
  });

  it('needs at least one invoice for a reimbursement', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'REIMBURSEMENT', projectId: uuidv7(), invoices: [] }).success).toBe(false);
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'REIMBURSEMENT', projectId: uuidv7(), invoices: [invoice] }).success).toBe(true);
  });

  it('takes a settlement against an advance, with no project of its own', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'SETTLEMENT', advanceId: uuidv7(), invoices: [invoice] }).success).toBe(true);
  });
});

describe('approval bodies', () => {
  it('lets the amount and comment be omitted on approve', () => {
    expect(ApproveSchema.parse({})).toEqual({});
  });
  it('requires a comment to return or reject', () => {
    expect(CommentSchema.safeParse({ comment: '  ' }).success).toBe(false);
    expect(CommentSchema.safeParse({ comment: 'Invoice unreadable' }).success).toBe(true);
  });
});

describe('payments', () => {
  const details = { mode: 'BANK_TRANSFER', reference: 'TXN-77', paidOn: '2026-10-05' };
  it('requires mode, reference and date', () => {
    expect(PaymentDetailsSchema.safeParse(details).success).toBe(true);
    expect(PaymentDetailsSchema.safeParse({ mode: 'BANK_TRANSFER' }).success).toBe(false);
  });
  it('allows an empty body for pay, since a settlement may need no payout', () => {
    expect(PayRequestSchema.parse({})).toEqual({});
  });
  it('refuses a mode we do not support', () => {
    expect(PaymentDetailsSchema.safeParse({ ...details, mode: 'BITCOIN' }).success).toBe(false);
  });
  it('needs an amount to return cash', () => {
    expect(CashReturnSchema.safeParse(details).success).toBe(false);
    expect(CashReturnSchema.safeParse({ ...details, amount: '2000' }).success).toBe(true);
  });
});

describe('ListRequestsQuerySchema', () => {
  it('defaults to my own requests', () => {
    expect(ListRequestsQuerySchema.parse({})).toMatchObject({ view: 'mine', page: 1, limit: 20 });
  });
});
