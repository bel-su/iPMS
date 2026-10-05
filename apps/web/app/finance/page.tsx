import type { RequestKind, RequestStatus, RequestView } from '../lib/finance-api';
import { listRequests } from '../lib/finance-api';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listUserDirectory } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { RequestsTable } from './requests-table';

interface Search { view?: string; status?: string; kind?: string; page?: string }

const VIEWS: Array<{ view: RequestView; label: string }> = [
  { view: 'awaiting', label: 'Waiting for me' }, { view: 'mine', label: 'My requests' }, { view: 'all', label: 'All requests' },
];

const asView = (value: string | undefined): RequestView | undefined => (value === 'awaiting' || value === 'mine' || value === 'all' ? value : undefined);

export default async function FinancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p></StatePage>;
  }

  const user = viewer.data;
  const mayAct = ['finance_approval.pm', 'finance_approval.director', 'finance_payment.record'].some((p) => hasPermission(user, p));
  const mayRaise = hasPermission(user, 'finance_request.create');
  const seeAll = hasPermission(user, 'finance_request.view_all');
  const tabs = VIEWS.filter(({ view }) => (view === 'awaiting' ? mayAct : view === 'all' ? seeAll : true));
  const view = asView(search.view) ?? (mayAct ? 'awaiting' : 'mine');
  const page = Math.max(1, Number(search.page) || 1);

  const [result, directory] = await Promise.all([
    listRequests({ view, page, ...(search.status ? { status: search.status as RequestStatus } : {}), ...(search.kind ? { kind: search.kind as RequestKind } : {}) }),
    listUserDirectory(),
  ]);
  if (result.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);

  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Finance</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>Advances &amp; settlements</h1>
              <p className="subtle">Requests for money, their approvals, and where each one stands.</p>
            </div>
            {mayRaise ? <a className="primary-button" href="/finance/new">+ New request</a> : null}
          </div>
          <section className="panel">
            <nav className="finance-tabs" aria-label="Views">
              {tabs.map((tab) => (
                <a key={tab.view} href={`/finance?view=${tab.view}`} aria-current={tab.view === view ? 'page' : undefined}>{tab.label}</a>
              ))}
            </nav>
            <RequestsTable page={result.data} names={names} view={view} />
          </section>
        </div>
      </section>
    </main>
  );
}
