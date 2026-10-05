import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyDownload = vi.fn().mockResolvedValue(new Response('xlsx'));
vi.mock('../../../lib/download', () => ({ proxyDownload }));

const { GET } = await import('./route');
beforeEach(() => proxyDownload.mockClear());

describe('GET /api/finance/report', () => {
  it('asks the finance service for the workbook with the chosen grouping and dates', async () => {
    await GET(new Request('http://web/api/finance/report?groupBy=category&from=2026-10-01&to=2026-10-31'));
    expect(proxyDownload).toHaveBeenCalledWith(
      '/api/v1/finance/reports/project-spend?groupBy=category&from=2026-10-01&to=2026-10-31&format=xlsx',
      'finance-spend-by-category.xlsx',
      expect.stringContaining('finance'),
    );
  });

  it('defaults to grouping by project and drops empty filters', async () => {
    await GET(new Request('http://web/api/finance/report'));
    expect(proxyDownload).toHaveBeenCalledWith('/api/v1/finance/reports/project-spend?groupBy=project&format=xlsx', 'finance-spend-by-project.xlsx', expect.any(String));
  });

  it('ignores a grouping it does not know', async () => {
    await GET(new Request('http://web/api/finance/report?groupBy=%27%3Bdrop'));
    expect(proxyDownload.mock.calls[0]?.[0]).toContain('groupBy=project');
  });

  it('passes a well-formed projectId and drops a malformed one', async () => {
    const id = '3f2a91c0-1111-2222-3333-444455556666';
    await GET(new Request(`http://web/api/finance/report?projectId=${id}`));
    expect(proxyDownload.mock.calls[0]?.[0]).toContain(`projectId=${id}`);
    proxyDownload.mockClear();
    await GET(new Request('http://web/api/finance/report?projectId=1%3Bdrop'));
    expect(proxyDownload.mock.calls[0]?.[0]).not.toContain('projectId');
  });
});
