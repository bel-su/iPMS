import { redirect } from 'next/navigation';

/** Work orders moved under Quality & EHS; old links keep their filters. */
export default async function WorkOrdersMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  const text = query.toString();
  redirect(`/quality/work-orders${text ? `?${text}` : ''}`);
}
