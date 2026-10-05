import { WORK_ORDERS_PATH } from '../quality/work-orders/labels';
import { StatePage } from '../shell';

/** Pieces shared by the QC and field engineer homes, which show no money. */

export function Kpi({ label, value, unit, note, tone = 'muted' }: {
  label: string; value: string; unit: string; note: string; tone?: 'muted' | 'green' | 'amber' | 'red';
}) {
  return (
    <article className="ov-card ov-kpi">
      <p className="ov-kpi-label">{label}</p>
      <p className="ov-kpi-value"><strong>{value}</strong><span>{unit}</span></p>
      <p className={`ov-kpi-note ${tone}`}>{note}</p>
    </article>
  );
}

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></svg>
  );
}

export function SignInPage({ what }: { what: string }) {
  return (
    <StatePage eyebrow="SECURE WORKSPACE" title={`Sign in to see ${what}`}>
      <p>This page reads live data through the Axiom gateway.</p>
      <a className="primary-button" href="/login">Sign in</a>
    </StatePage>
  );
}

export const newWorkOrderHref = `${WORK_ORDERS_PATH}/new`;
