import { redirect } from 'next/navigation';

/** Work orders moved under Quality & EHS. */
export default async function NewWorkOrderMoved({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  redirect(`/quality/work-orders/new${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
}
