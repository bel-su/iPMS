'use client';
import { useActionState } from 'react';
import type { TemplateImportPreview } from '@ipms/contracts';
import { FormError, SubmitButton } from '../../../components/forms';
import { commitTemplateImportAction, previewTemplateImportAction, type TemplateImportState } from './actions';

const START: TemplateImportState = {};

function commitPayload(preview: TemplateImportPreview): string | null {
  if (!preview.metadata || !preview.document) return null;
  const draft = preview.target?.kind === 'EXISTING' ? preview.target.replacesDraft : null;
  return JSON.stringify({ ...preview.metadata, document: preview.document, ...(draft ? { expectedDraftRevision: draft.revision } : {}) });
}

export function TemplateImportForm() {
  const [previewState, previewAction] = useActionState(previewTemplateImportAction, START);
  const [commitState, commitAction] = useActionState(commitTemplateImportAction, START);
  const preview = previewState.preview;
  const payload = preview ? commitPayload(preview) : null;

  return (
    <>
      <form action={previewAction} className="panel-form">
        <label className="field">Workbook<input type="file" name="file" accept=".xlsx" required /></label>
        <FormError state={previewState} />
        <SubmitButton>Preview</SubmitButton>
      </form>

      {preview && preview.errors.length > 0 ? (
        <section className="panel">
          <div className="panel-header"><div><h2>Fix these problems and preview again</h2><p>Nothing has been saved.</p></div></div>
          <table className="data-table">
            <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
            <tbody>
              {preview.errors.map((error, index) => (
                <tr key={index}><td>{error.row ?? '—'}</td><td>{error.column ?? '—'}</td><td>{error.message}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {preview && payload && preview.summary && preview.metadata ? (
        <section className="panel">
          <div className="panel-header"><div>
            <h2>{preview.target?.kind === 'EXISTING' ? `Becomes v${preview.target.nextVersion} draft of ${preview.metadata.code}` : `New template ${preview.metadata.code}`}</h2>
            <p>{preview.summary.sections} sections · {preview.summary.items} items · {preview.summary.critical} critical · {preview.summary.withPhotos} with photos</p>
          </div></div>
          {preview.warnings.length > 0 ? <ul className="banner warning">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
          <form action={commitAction}>
            <input type="hidden" name="payload" value={payload} />
            <FormError state={commitState} />
            <SubmitButton>Confirm import</SubmitButton>
          </form>
        </section>
      ) : null}
    </>
  );
}
