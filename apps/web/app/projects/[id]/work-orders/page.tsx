import { redirect } from 'next/navigation';
import { projectWorkOrders } from '../paths';

/** Kept so old links land somewhere: a project's tasks are its work orders, on the workspace dashboard. */
export default async function ProjectTasksRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(projectWorkOrders(id));
}
