import { redirect } from 'next/navigation';

/** Work orders moved under Quality & EHS; kept so shared links still land. */
export default async function WorkOrderMoved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/quality/work-orders/${encodeURIComponent(id)}`);
}
