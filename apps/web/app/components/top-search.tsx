'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { searchScope } from './search-scope';

/**
 * The topbar search. Rendered by `TopActions`, so every signed-in page has it,
 * and it searches the section the page belongs to. It is a plain GET form: it
 * works before hydration and the result is a link anyone can share.
 */
export function TopSearch() {
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = searchScope(pathname);
  // Only on the list page itself is there a filter state worth carrying over or a term worth showing.
  const onList = pathname === scope.action;
  const kept = onList ? scope.keep.map((name) => [name, params.get(name)] as const).filter((pair): pair is readonly [string, string] => Boolean(pair[1])) : [];

  return (
    <form className="top-search" action={scope.action} method="get" role="search" key={`${pathname}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      {kept.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <input type="search" name={scope.field} defaultValue={onList ? params.get(scope.field) ?? '' : ''} placeholder={scope.placeholder} aria-label={scope.placeholder.replace('…', '')} maxLength={100} />
    </form>
  );
}
