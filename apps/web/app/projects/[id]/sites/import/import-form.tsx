'use client';
import { useActionState } from 'react';
import { SubmitButton } from '../../../../components/forms';
import { commitImportAction, previewImportAction, type ImportState } from './actions';

const EMPTY: ImportState = {};

export function SiteImportForm({ projectId }: { projectId: string }) {
  const [preview, runPreview] = useActionState(previewImportAction, EMPTY);
  const [commit, runCommit] = useActionState(commitImportAction, EMPTY);

  if (commit.committed) {
    return (
      <p className="form-note">
        Imported {commit.committed.created} new site(s) and updated {commit.committed.updated}.
        {' '}<a href={`/projects/${projectId}/sites`}>Back to sites</a>
      </p>
    );
  }

  const report = preview.preview;

  return (
    <>
      <form action={runPreview} className="inline-form">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="field">Spreadsheet<input name="file" type="file" accept=".xlsx" required /></label>
        <SubmitButton>Preview</SubmitButton>
        {preview.error ? <p className="form-error">{preview.error}</p> : null}
      </form>

      {report ? (
        <>
          <p className="form-note">
            <strong>{report.summary.created}</strong> new
            {' · '}<strong>{report.summary.updated}</strong> to update
            {' · '}<strong>{report.summary.invalid}</strong> invalid
          </p>
          <table className="data-table">
            <thead><tr><th>Row</th><th>Site code</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td><code>{row.siteCode ?? '—'}</code></td>
                  <td><span className="badge">{row.action}</span></td>
                  <td>
                    {row.action === 'INVALID'
                      ? row.errors.join('; ')
                      : row.changes.length === 0
                        ? '—'
                        : row.changes.map((change) => `${change.field}: ${change.from ?? '(none)'} → ${change.to ?? '(none)'}`).join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {report.importable ? (
            <form action={runCommit}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="payload" value={JSON.stringify(report.importable)} />
              <SubmitButton>Import {report.summary.created + report.summary.updated} site(s)</SubmitButton>
              {commit.error ? <p className="form-error">{commit.error}</p> : null}
            </form>
          ) : (
            <p className="form-note">Fix the rows above and preview again. Nothing is imported until every row is valid.</p>
          )}
        </>
      ) : null}
    </>
  );
}
