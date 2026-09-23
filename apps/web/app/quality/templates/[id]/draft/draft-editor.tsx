'use client';
import { useEffect, useReducer, useRef, useState, useTransition } from 'react';
import type { ResponseType, Severity } from '@ipms/contracts';
import { RESPONSE_TYPES, RESPONSE_TYPE_LABELS } from '../../labels';
import { discardDraftAction, publishDraftAction, saveDraftAction, type EditorResult } from './actions';
import { editorReducer, fieldKey, fromSections, toDocument, type EditorAction, type EditorItem, type EditorSection, type ItemPatch, type WireSection } from './editor-state';

interface Props {
  templateId: string; version: number; revision: number; sections: WireSection[];
  previousVersion: number | null; neverPublished: boolean; mayPublish: boolean;
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error" role="alert">{message}</span> : null;
}

export function DraftEditor({ templateId, version, revision: initialRevision, sections, previousVersion, neverPublished, mayPublish }: Props) {
  const [state, dispatch] = useReducer(editorReducer, sections, fromSections);
  const [revision, setRevision] = useState(initialRevision);
  const [result, setResult] = useState<EditorResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = result?.fieldErrors ?? {};
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!state.dirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.dirty]);

  // sent is the document the request was made with; if the user kept editing before it returned, don't clear dirty.
  function apply(next: EditorResult, success: string | null, sent?: ReturnType<typeof toDocument>): void {
    if (next.revision !== null) {
      setRevision(next.revision);
      if (sent === undefined || JSON.stringify(toDocument(stateRef.current)) === JSON.stringify(sent)) dispatch({ type: 'saved' });
    }
    setResult(next);
    setNotice(next.error ? null : success);
  }

  const save = (): void => {
    const sent = toDocument(state);
    startTransition(async () => apply(await saveDraftAction(templateId, revision, sent), 'Draft saved.', sent));
  };

  const publish = (): void => {
    const message = previousVersion
      ? `v${version} will be used by all projects from now on, and v${previousVersion} retires. Publish?`
      : `v${version} will become available to all projects. Publish?`;
    if (!window.confirm(message)) return;
    const sent = toDocument(state);
    startTransition(async () => apply(await publishDraftAction(templateId, revision, sent), null, sent));
  };

  const discard = (): void => {
    const message = neverPublished
      ? 'Discard this draft? The template itself will be deleted, because it has never been published.'
      : `Discard the v${version} draft? The published version is not affected.`;
    if (!window.confirm(message)) return;
    startTransition(async () => apply(await discardDraftAction(templateId), null));
  };

  const updateItem = (section: EditorSection, item: EditorItem, patch: ItemPatch): void =>
    dispatch({ type: 'updateItem', sectionKey: section.key, itemKey: item.key, patch });

  // Structural edits shift section/item indices, so index-keyed field errors from the last save would point at the wrong row.
  const structural = (action: EditorAction): void => { setResult((prev) => (prev ? { ...prev, fieldErrors: {} } : prev)); dispatch(action); };

  return (
    <div className="editor">
      {result?.conflict ? (
        <div className="banner warning" role="alert">
          <span>{result.error}</span>
          <button type="button" className="ghost-button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      ) : result?.error ? (
        <p className="form-error" role="alert">
          {result.error}{Object.keys(errors).length > 0 ? ` — ${Object.keys(errors).length} field(s) need attention; they are marked below.` : ''}
        </p>
      ) : null}
      {notice ? <p className="subtle" role="status">{notice}</p> : null}
      <FieldError message={errors['sections']} />

      {state.sections.map((section, s) => (
        <section key={section.key} className="editor-section">
          <div className="editor-section-header">
            <label className="field">Section No
              <input value={section.number} maxLength={30} onChange={(e) => dispatch({ type: 'updateSection', sectionKey: section.key, patch: { number: e.target.value } })} />
              <FieldError message={errors[fieldKey(s, null, 'number')]} />
            </label>
            <label className="field">Section title
              <input value={section.title} maxLength={300} onChange={(e) => dispatch({ type: 'updateSection', sectionKey: section.key, patch: { title: e.target.value } })} />
              <FieldError message={errors[fieldKey(s, null, 'title')]} />
            </label>
            <div className="editor-controls">
              <button type="button" className="ghost-button" aria-label={`Move section ${section.number} up`} onClick={() => structural({ type: 'moveSection', sectionKey: section.key, direction: -1 })}>↑</button>
              <button type="button" className="ghost-button" aria-label={`Move section ${section.number} down`} onClick={() => structural({ type: 'moveSection', sectionKey: section.key, direction: 1 })}>↓</button>
              <button type="button" className="danger-button" onClick={() => { if (section.items.length === 0 || window.confirm(`Remove section ${section.number} and its ${section.items.length} items?`)) structural({ type: 'removeSection', sectionKey: section.key }); }}>Remove</button>
            </div>
          </div>
          <FieldError message={errors[fieldKey(s, null, 'items')]} />

          {section.items.map((item, i) => {
            const err = (field: string): string | undefined => errors[fieldKey(s, i, field)];
            return (
              <div key={item.key} className="editor-item">
                <label className="field">Item No
                  <input value={item.number} maxLength={30} onChange={(e) => updateItem(section, item, { number: e.target.value })} />
                  <FieldError message={err('number')} />
                </label>
                <div>
                  <label className="field">Requirement
                    <textarea rows={2} value={item.requirementText} maxLength={5000} onChange={(e) => updateItem(section, item, { requirementText: e.target.value })} />
                    <FieldError message={err('requirementText')} />
                  </label>
                  <div className="editor-item-fields">
                    <label className="field">Severity
                      <select value={item.severity} onChange={(e) => updateItem(section, item, { severity: e.target.value as Severity })}>
                        <option value="NORMAL">Normal</option><option value="CRITICAL">Critical</option>
                      </select>
                    </label>
                    <label className="field">Response type
                      <select value={item.responseType} onChange={(e) => updateItem(section, item, { responseType: e.target.value as ResponseType })}>
                        {RESPONSE_TYPES.map((type) => <option key={type} value={type}>{RESPONSE_TYPE_LABELS[type]}</option>)}
                      </select>
                    </label>
                    <label className="field">Min photos
                      <input type="number" min={0} max={20} value={item.minPhotos} onChange={(e) => updateItem(section, item, { minPhotos: Number(e.target.value) })} />
                      <FieldError message={err('minPhotos')} />
                    </label>
                    <label className="field">Max photos
                      <input type="number" min={0} max={20} value={item.maxPhotos} onChange={(e) => updateItem(section, item, { maxPhotos: Number(e.target.value) })} />
                      <FieldError message={err('maxPhotos')} />
                    </label>
                    <label className="field"><span>Allow N/A</span>
                      <input type="checkbox" checked={item.allowsNa} onChange={(e) => updateItem(section, item, { allowsNa: e.target.checked })} />
                    </label>
                    <label className="field"><span>Required</span>
                      <input type="checkbox" checked={item.isRequired} onChange={(e) => updateItem(section, item, { isRequired: e.target.checked })} />
                    </label>
                  </div>
                  {item.responseType === 'SELECT' ? (
                    <label className="field">Options (one per line)
                      <textarea rows={3} value={item.optionsText} onChange={(e) => updateItem(section, item, { optionsText: e.target.value })} />
                      <FieldError message={err('selectOptions')} />
                    </label>
                  ) : null}
                  <label className="field">Guidance for the field engineer
                    <textarea rows={1} value={item.guidanceText} maxLength={2000} onChange={(e) => updateItem(section, item, { guidanceText: e.target.value })} />
                    <FieldError message={err('guidanceText')} />
                  </label>
                  <div className="editor-controls">
                    <button type="button" className="ghost-button" aria-label={`Move item ${item.number} up`} onClick={() => structural({ type: 'moveItem', sectionKey: section.key, itemKey: item.key, direction: -1 })}>↑</button>
                    <button type="button" className="ghost-button" aria-label={`Move item ${item.number} down`} onClick={() => structural({ type: 'moveItem', sectionKey: section.key, itemKey: item.key, direction: 1 })}>↓</button>
                    <button type="button" className="danger-button" onClick={() => structural({ type: 'removeItem', sectionKey: section.key, itemKey: item.key })}>Remove item</button>
                  </div>
                </div>
              </div>
            );
          })}
          <button type="button" className="ghost-button" onClick={() => structural({ type: 'addItem', sectionKey: section.key })}>Add item</button>
        </section>
      ))}

      <div className="editor-bar">
        <button type="button" className="ghost-button" onClick={() => structural({ type: 'addSection' })}>Add section</button>
        <button type="button" className="ghost-button" onClick={() => structural({ type: 'renumber' })}>Renumber</button>
        <span className="subtle">{state.dirty ? 'Unsaved changes' : `Saved · revision ${revision}`}</span>
        <button type="button" className="primary-button" disabled={pending} onClick={save}>{pending ? 'Working…' : 'Save draft'}</button>
        {mayPublish ? <button type="button" className="primary-button" disabled={pending} onClick={publish}>Publish v{version}</button> : null}
        <button type="button" className="danger-button" disabled={pending} onClick={discard}>Discard draft</button>
      </div>
    </div>
  );
}
