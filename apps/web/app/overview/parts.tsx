import { WORK_ORDERS_PATH } from '../quality/work-orders/labels';
import { StatePage } from '../shell';

/** Pieces shared by the QC and field engineer homes, which show no finance figures. */

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

/**
 * Staff below manager can ask for an advance but never see anyone's money. The
 * button is a placeholder: the request form arrives with the Finance service.
 */
export function RequestAdvancePanel() {
  return (
    <section className="ov-card ov-panel" id="request-advance">
      <header className="ov-panel-head">
        <div><h2>Request an advance</h2><p>Ask for cash against a work order, for things like crane hire or fuel. Your project manager decides.</p></div>
      </header>
      <button type="button" className="ra-button" disabled title="Available when the Finance service is connected">Request advance</button>
      <p className="ov-note ra-note">Advance requests open when the Finance service is connected.</p>
    </section>
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
