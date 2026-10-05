import { listCategories } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { CategoryRow, CreateCategoryForm } from './forms';

export default async function CategoriesPage() {
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to manage categories"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_category.manage')) {
    return <StatePage title="Only finance can manage categories"><p>Your role does not include expense categories.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }

  const result = await listCategories();
  if (result.state !== 'ready') {
    return <StatePage title="Categories are not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }

  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>Categories</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>Expense categories</h1>
              <p className="subtle">What invoices are filed under. A disabled category stays on old requests but cannot be picked for new ones.</p>
            </div>
          </div>
          <section className="panel">
            <CreateCategoryForm />
            {result.data.length === 0 ? <p className="finance-empty">No categories yet.</p> : (
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead><tr><th>Code</th><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>{result.data.map((category) => <CategoryRow key={category.id} category={category} />)}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
