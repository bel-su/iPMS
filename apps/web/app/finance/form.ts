import type { InvoiceInput } from '../lib/finance-api';

/** "1,50,000.5" -> "150000.50". Null for anything that is not a positive amount with at most two decimals. */
export function parseMoney(text: string | undefined): string | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (/\s/.test(trimmed) || /,,|^,|,\.|\.,/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  if (whole.replace(/^0+(?=\d)/, '').length > 12) return null;
  const normalised = `${whole.replace(/^0+(?=\d)/, '')}.${(fraction + '00').slice(0, 2)}`;
  return Number(normalised) > 0 ? normalised : null;
}

const field = (form: FormData, name: string): string[] => form.getAll(name).map((value) => String(value).trim());
/** A real calendar date in YYYY-MM-DD form, from 1900 on. */
const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Invoice rows arrive as four aligned lists (one entry per row). A row left
 * entirely blank is ignored, so the empty spare row a form shows is harmless.
 */
export function parseInvoices(form: FormData): { invoices: InvoiceInput[] } | { error: string } {
  const vendors = field(form, 'invoiceVendor');
  const numbers = field(form, 'invoiceNumber');
  const dates = field(form, 'invoiceDate');
  const amounts = field(form, 'invoiceAmount');
  const invoices: InvoiceInput[] = [];

  const count = Math.max(vendors.length, numbers.length, dates.length, amounts.length);

  for (let i = 0; i < count; i += 1) {
    const [vendor = '', invoiceNumber = '', invoiceDate = '', rawAmount = ''] = [vendors[i], numbers[i], dates[i], amounts[i]];
    if (!vendor && !invoiceNumber && !invoiceDate && !rawAmount) continue;
    const row = `Invoice ${i + 1}`;
    if (!vendor || !invoiceNumber || !invoiceDate || !rawAmount) return { error: `${row}: enter the vendor, invoice number, date and amount.` };
    if (!validDate(invoiceDate)) return { error: `${row}: enter a valid date.` };
    const amount = parseMoney(rawAmount);
    if (amount === null) return { error: `${row}: enter an amount in NPR with at most two decimals.` };
    invoices.push({ vendor, invoiceNumber, invoiceDate, amount });
  }
  return invoices.length === 0 ? { error: 'Add at least one invoice.' } : { invoices };
}
