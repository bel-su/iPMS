import type { ChecklistSection } from '../../lib/qc-api';
import { RESPONSE_TYPE_LABELS, photoLabel } from './labels';

export function VersionView({ sections }: { sections: ChecklistSection[] }) {
  if (sections.length === 0) return <p className="empty-list">This version has no sections yet.</p>;
  return (
    <div className="checklist">
      {sections.map((section) => (
        <details key={section.id} className="checklist-section" open>
          <summary><strong>{section.number}</strong> {section.title} <span className="subtle">({section.items.length} items)</span></summary>
          <ol className="checklist-items">
            {section.items.map((item) => {
              const photos = photoLabel(item.minPhotos, item.maxPhotos);
              return (
                <li key={item.id} className="checklist-item">
                  <div><strong>{item.number}</strong> {item.requirementText}</div>
                  <div className="badges">
                    {item.severity === 'CRITICAL' ? <span className="badge red">Critical</span> : null}
                    <span className="badge slate">{RESPONSE_TYPE_LABELS[item.responseType]}</span>
                    {item.responseType === 'SELECT' ? <span className="badge slate">{item.selectOptions.join(' · ')}</span> : null}
                    {photos ? <span className="badge blue">{photos}</span> : null}
                    {item.allowsNa ? <span className="badge slate">N/A allowed</span> : null}
                    {item.isRequired ? null : <span className="badge amber">Optional</span>}
                  </div>
                  {item.guidanceText ? <p className="subtle">{item.guidanceText}</p> : null}
                </li>
              );
            })}
          </ol>
        </details>
      ))}
    </div>
  );
}
