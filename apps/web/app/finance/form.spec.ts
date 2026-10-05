import { describe, expect, it } from 'vitest';
import { parseInvoices, parseMoney } from './form';

const form = (rows: Array<[string, string, string, string]>) => {
  const data = new FormData();
  for (const [vendor, number, date, amount] of rows) {
    data.append('invoiceVendor', vendor); data.append('invoiceNumber', number);
    data.append('invoiceDate', date); data.append('invoiceAmount', amount);
  }
  return data;
};

describe('parseMoney', () => {
  it.each([
    ['1500', '1500.00'], ['1,50,000.5', '150000.50'], [' 40000.25 ', '40000.25'], ['0.5', '0.50'], ['7.', '7.00'],
  ])('reads %s as %s', (input, expected) => expect(parseMoney(input)).toBe(expected));

  it.each(['', '  ', 'abc', '-5', '0', '0.00', '1.234', '12e3', undefined])('refuses %s', (input) => expect(parseMoney(input as never)).toBeNull());
});

describe('parseInvoices', () => {
  it('reads aligned rows into invoices with normalised amounts', () => {
    expect(parseInvoices(form([['Himal Fuel', 'I-1', '2026-10-01', '1,500.5'], ['Sajha Hardware', 'I-2', '2026-10-02', '250']]))).toEqual({
      invoices: [
        { vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1500.50' },
        { vendor: 'Sajha Hardware', invoiceNumber: 'I-2', invoiceDate: '2026-10-02', amount: '250.00' },
      ],
    });
  });

  it('ignores a completely empty row and trims fields', () => {
    expect(parseInvoices(form([['  Himal Fuel ', ' I-1 ', '2026-10-01', '100'], ['', '', '', '']]))).toEqual({
      invoices: [{ vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '100.00' }],
    });
  });

  it('asks for at least one invoice', () => {
    expect(parseInvoices(form([['', '', '', '']]))).toEqual({ error: 'Add at least one invoice.' });
  });

  it('names the row and the problem when an invoice is incomplete or its amount is wrong', () => {
    expect(parseInvoices(form([['Himal Fuel', '', '2026-10-01', '100']]))).toEqual({ error: 'Invoice 1: enter the vendor, invoice number, date and amount.' });
    expect(parseInvoices(form([['A', '1', '2026-10-01', '100'], ['B', '2', '2026-10-01', '1.234']]))).toEqual({ error: 'Invoice 2: enter an amount in NPR with at most two decimals.' });
    expect(parseInvoices(form([['A', '1', 'not-a-date', '100']]))).toEqual({ error: 'Invoice 1: enter a valid date.' });
  });
});
