import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestsTable } from './requests-table';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_PM', revision: 1, entryStatus: 'PENDING_PM',
  projectId: 'p-1', projectCode: 'KOS', projectName: 'Koshi Rollout', workOrderId: null, categoryId: 'c-1',
  requesterId: 'u-eng', advanceId: null, purpose: 'Site travel', requestedAmount: '50000.00', approvedAmount: null,
  appliedAmount: null, submittedAt: '2026-10-05T08:00:00Z', createdAt: '2026-10-05T07:00:00Z', updatedAt: '2026-10-05T08:00:00Z',
  category: { code: 'TRAVEL', name: 'Travel' }, ...over,
});
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, limit: 20, ...extra }) as never;
const names = new Map([['u-eng', 'Sita Rai']]);
const html = (items: unknown[], extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<RequestsTable page={page(items, extra)} names={names} view="awaiting" />);

describe('RequestsTable', () => {
  it('links each request to its page and shows who, what and how much', () => {
    const out = html([row()]);
    expect(out).toContain('href="/finance/requests/r-1"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('Koshi Rollout');
    expect(out).toContain('Sita Rai');
    expect(out).toContain('NPR 50,000.00');
    expect(out).toContain('With project manager');
  });

  it('shows the approved amount beside the requested one once there is one', () => {
    expect(html([row({ status: 'PENDING_FINANCE', approvedAmount: '40000.00' })])).toContain('NPR 40,000.00');
  });

  it('says so when nothing is waiting', () => {
    expect(html([])).toContain('Nothing here yet.');
  });

  it('uses scoped class names', () => {
    const out = html([row()]);
    expect(out).toContain('finance-pill');
    expect(out).toContain('finance-num');
  });

  it('keeps the view and filters in the next-page link', () => {
    const out = renderToStaticMarkup(
      <RequestsTable page={page([row()], { total: 45 })} names={names} view="all" query={{ status: 'PAID', kind: 'ADVANCE' }} />,
    );
    const href = /href="([^"]*page=2[^"]*)"/.exec(out)?.[1] ?? '';
    expect(href).toContain('view=all');
    expect(href).toContain('status=PAID');
    expect(href).toContain('kind=ADVANCE');
  });

  it('offers the next page when there is one', () => {
    expect(html([row()], { total: 45 })).toContain('page=2');
  });
});
