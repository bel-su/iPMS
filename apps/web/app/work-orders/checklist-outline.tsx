import type { ChecklistSection } from '../lib/qc-api';
import { RESPONSE_TYPE_LABELS, photoLabel } from '../quality/templates/labels';

/**
 * The shape of a checklist at a glance: how big it is, what is critical, what
 * needs photos, and — one click away — each section's items. A summary for
 * the person assigning the work, not a mock of the form the engineer fills in.
 *
 * No hooks, so the server detail page and the client composer both render it.
 */
export function ChecklistOutline({ sections }: { sections: ChecklistSection[] }) {
  const items = sections.flatMap((section) => section.items);
  const critical = items.filter((item) => item.severity === 'CRITICAL').length;
  const photos = items.filter((item) => item.minPhotos > 0).length;
  if (sections.length === 0) return <p className="subtle">This checklist has no sections.</p>;
  return (
    <div className="outline">
      <dl className="outline-stats">
        <div><dt>Sections</dt><dd>{sections.length}</dd></div>
        <div><dt>Items</dt><dd>{items.length}</dd></div>
        <div><dt>Critical</dt><dd className={critical ? 'red' : undefined}>{critical}</dd></div>
        <div><dt>Photo proof</dt><dd>{photos}</dd></div>
      </dl>
      <ol className="outline-sections">
        {sections.map((section) => {
          const sectionCritical = section.items.filter((item) => item.severity === 'CRITICAL').length;
          return (
            <li key={section.id}>
              <details>
                <summary>
                  <span className="outline-num">{section.number}</span>
                  <span className="outline-title">{section.title}</span>
                  <span className="outline-meta">{section.items.length}{sectionCritical ? <b title="Critical items"> · {sectionCritical}!</b> : null}</span>
                </summary>
                <ul className="outline-items">
                  {section.items.map((item) => {
                    const photo = photoLabel(item.minPhotos, item.maxPhotos);
                    return (
                      <li key={item.id} className={item.severity === 'CRITICAL' ? 'critical' : undefined}>
                        <span className="outline-num">{item.number}</span>
                        <span>
                          {item.requirementText}
                          <span className="outline-tags">
                            {item.severity === 'CRITICAL' ? <i className="tag red">Critical</i> : null}
                            {item.responseType !== 'RESULT_ONLY' ? <i className="tag">{RESPONSE_TYPE_LABELS[item.responseType]}</i> : null}
                            {photo ? <i className="tag">{photo}</i> : null}
                            {item.allowsNa ? <i className="tag">N/A allowed</i> : null}
                            {item.isRequired ? null : <i className="tag">Optional</i>}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
