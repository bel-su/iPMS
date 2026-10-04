'use client';

/** The category filter; picking an option applies it straight away. */
export function CategorySelect({ value, options }: { value: string; options: { value: string; label: string }[] }) {
  return (
    <div className="lib-select-wrap">
      <select className="lib-select" name="category" defaultValue={value} aria-label="Category" onChange={(event) => event.currentTarget.form?.requestSubmit()}>
        <option value="">All categories</option>
        {options.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </div>
  );
}
