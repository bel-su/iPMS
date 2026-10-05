import type { FinanceRequest, RequestPage, RequestView } from '../lib/finance-api';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, formatMoney, personName } from './model';

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

function pageHref(view: RequestView, page: number): string {
  return `/finance?view=${view}&page=${page}`;
}

/** The finance workspace's list: one row per request, newest first, linking to the request. */
export function RequestsTable({ page, names, view }: { page: RequestPage; names: ReadonlyMap<string, string>; view: RequestView }) {
  if (page.items.length === 0) return <p className="finance-empty">Nothing here yet.</p>;
  const last = Math.max(1, Math.ceil(page.total / page.limit));
  return (
    <>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr><th>Request</th><th>Project</th><th>For</th><th>Requested by</th><th className="num">Amount</th><th>Status</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {page.items.map((request: FinanceRequest) => (
              <tr key={request.id}>
                <td><a href={`/finance/requests/${request.id}`}><strong>{request.number}</strong></a><span className="subtle">{KIND_LABEL[request.kind]}</span></td>
                <td>{request.projectName}<span className="subtle">{request.projectCode}</span></td>
                <td>{request.purpose}<span className="subtle">{request.category?.name ?? ''}</span></td>
                <td>{personName(request.requesterId, names)}</td>
                <td className="num">
                  {formatMoney(request.approvedAmount ?? request.requestedAmount)}
                  {request.approvedAmount !== null && request.approvedAmount !== request.requestedAmount
                    ? <span className="subtle">asked {formatMoney(request.requestedAmount)}</span> : null}
                </td>
                <td><span className={`pill ${STATUS_TONE[request.status]}`}>{STATUS_LABEL[request.status]}</span></td>
                <td>{DATE.format(new Date(request.updatedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {last > 1 ? (
        <nav className="pager" aria-label="Pages">
          {page.page > 1 ? <a className="ghost-button" href={pageHref(view, page.page - 1)}>Previous</a> : <span />}
          <span className="subtle">Page {page.page} of {last}</span>
          {page.page < last ? <a className="ghost-button" href={pageHref(view, page.page + 1)}>Next</a> : <span />}
        </nav>
      ) : null}
    </>
  );
}
