import { getCurrentUser } from './lib/iam-api';
import { AdminOverview } from './overview/admin-overview';
import { EngineerOverview } from './overview/engineer-overview';
import { ManagerOverview } from './overview/manager-overview';
import { homeFor } from './overview/model';
import { QcOverview } from './overview/qc-overview';

/**
 * One address, four homes, chosen by role: managers land on their decision
 * queue, QC on the review desk, engineers on their own work, and everyone else
 * (administrators included) on the organisation overview. Which home is a view
 * choice, never a boundary — every one reads through the gateway as the
 * signed-in person.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ log?: string; tab?: string }> }) {
  const viewer = await getCurrentUser();
  switch (viewer.state === 'ready' ? homeFor(viewer.data.roles) : 'admin') {
    case 'manager': return <ManagerOverview searchParams={searchParams} />;
    case 'qc': return <QcOverview />;
    case 'engineer': return <EngineerOverview />;
    default: return <AdminOverview searchParams={searchParams} />;
  }
}
