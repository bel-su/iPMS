'use client';

import { BrandMark } from './components/brand';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="state-page">
          <section className="state-card">
            <a className="brand" href="/" aria-label="Axiom home"><BrandMark /></a>
            <p className="eyebrow">Application error</p>
            <h1>Critical error</h1>
            <p className="subtle">A critical system error occurred.</p>
            <div style={{ marginTop: '16px' }}>
              <button type="button" className="primary-button" onClick={() => reset()}>
                Reload application
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
