import { redirect } from 'next/navigation';
import { getCurrentUser, hasPermission } from '../lib/iam-api';

/** Quality & EHS has no page of its own: it opens on work orders, or on the checklist library for someone who only manages templates. */
export default async function QualityHome() {
  const viewer = await getCurrentUser();
  const templatesOnly = viewer.state === 'ready' && !hasPermission(viewer.data, 'task.view') && hasPermission(viewer.data, 'qc_template.view');
  redirect(templatesOnly ? '/quality/templates' : '/quality/work-orders');
}
