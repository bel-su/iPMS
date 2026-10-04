'use client';

import { useState } from 'react';
import { useActionStateWithToast } from '../../../components/toast';
import type { ChecklistSection, ReviewResult, SubmissionDetail } from '../../../lib/qc-api';
import { reviewSubmissionAction } from '../actions';
import { Evidence } from './evidence';
import type { EvidenceFile } from './evidence-model';

interface ReviewConsoleProps {
  submission: SubmissionDetail;
  projectId: string;
  workOrderId: string;
  canApprove: boolean;
  canReject: boolean;
  /** Files per response id. */
  evidence: Map<string, EvidenceFile[]>;
  /** Sections of the version submitted against; without them items are listed flat. */
  sections?: ChecklistSection[] | null;
}

type Response = SubmissionDetail['responses'][number];

const VERDICT_PILL: Record<string, { label: string; icon: string }> = {
  APPROVED: { label: 'Approved', icon: '✓' },
  REJECTED: { label: 'Rejected', icon: '✕' },
  NA: { label: 'N/A', icon: '–' },
};

const FIELD_TONE: Record<string, string> = { PASS: 'green', FAIL: 'red', NA: 'slate' };

interface ItemReviewState {
  result: ReviewResult;
  description: string;
}

export function ReviewConsole({
  submission,
  projectId,
  workOrderId,
  canApprove,
  canReject,
  evidence,
  sections,
}: ReviewConsoleProps) {
  const [state, formAction, isPending] = useActionStateWithToast(reviewSubmissionAction, {}, 'Review submitted');

  // Initialize each item review with default APPROVED or matching existing verdict
  const [reviews, setReviews] = useState<Record<string, ItemReviewState>>(() => {
    const initial: Record<string, ItemReviewState> = {};
    for (const response of submission.responses) {
      initial[response.itemId] = {
        result: response.selfCheckResult === 'NA' ? 'NA' : 'APPROVED',
        description: '',
      };
    }
    return initial;
  });

  const [decision, setDecision] = useState<'APPROVE' | 'REJECT_REWORK'>('APPROVE');
  const [overallComment, setOverallComment] = useState('');

  const hasRejectedItem = Object.values(reviews).some((r) => r.result === 'REJECTED');

  function setItemResult(itemId: string, result: ReviewResult) {
    setReviews((prev) => {
      const current = prev[itemId] ?? { result: 'APPROVED', description: '' };
      return {
        ...prev,
        [itemId]: { ...current, result },
      };
    });
    // If user rejects an item, automatically suggest overall REJECT_REWORK decision
    if (result === 'REJECTED') {
      setDecision('REJECT_REWORK');
    }
  }

  function setItemDescription(itemId: string, description: string) {
    setReviews((prev) => {
      const current = prev[itemId] ?? { result: 'APPROVED', description: '' };
      return {
        ...prev,
        [itemId]: { ...current, description },
      };
    });
  }

  const byItem = new Map(submission.responses.map((r) => [r.itemId, r]));
  const groups: { key: string; title: string | null; responses: Response[] }[] = sections
    ? sections
        .map((section) => ({
          key: section.id,
          title: `${section.number} ${section.title}`,
          responses: section.items.map((item) => byItem.get(item.id)).filter((r): r is Response => Boolean(r)),
        }))
        .filter((group) => group.responses.length > 0)
    : [{ key: 'all', title: null, responses: [...submission.responses].sort((a, b) => a.item.order - b.item.order) }];

  const counts = { APPROVED: 0, REJECTED: 0, NA: 0 };
  for (const response of submission.responses) {
    const result = reviews[response.itemId]?.result ?? 'APPROVED';
    if (result in counts) counts[result as keyof typeof counts] += 1;
  }

  const payloadReviews = submission.responses.map((response: SubmissionDetail['responses'][number]) => ({
    itemId: response.itemId,
    result: reviews[response.itemId]?.result ?? 'APPROVED',
    ...(reviews[response.itemId]?.description ? { description: reviews[response.itemId]?.description } : {}),
  }));

  return (
    <section className="panel review-console-panel">
      <div className="review-console-header">
        <div>
          <span className="badge amber">QC inspection</span>
          <h2 className="panel-title">Review submission #{submission.attemptNo}</h2>
          <p className="subtle">
            Check the photo proof for each requirement. Items are approved by default; reject any that need rework.
          </p>
        </div>
        <ul className="review-tally" aria-label="Review summary">
          <li className="green"><b>{counts.APPROVED}</b> Approved</li>
          <li className="red"><b>{counts.REJECTED}</b> Rejected</li>
          {counts.NA > 0 ? <li className="slate"><b>{counts.NA}</b> N/A</li> : null}
        </ul>
      </div>

      <form action={formAction} className="review-form">
        <input type="hidden" name="submissionId" value={submission.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="workOrderId" value={workOrderId} />
        <input type="hidden" name="decision" value={decision} />
        <input type="hidden" name="itemReviews" value={JSON.stringify(payloadReviews)} />

        <div className="review-items-list">
          {groups.map((group) => (
            <div key={group.key} className="review-group">
              {group.title ? <h3 className="review-group-title">{group.title}</h3> : null}
              {group.responses.map((response) => {
                const current = reviews[response.itemId]?.result ?? 'APPROVED';
                const files = evidence.get(response.id) ?? [];
                const photoCount = files.filter((f) => f.kind === 'PHOTO').length;
                const videoCount = files.length - photoCount;
                return (
                  <div key={response.id} className={`review-item-card ${current.toLowerCase()}`}>
                    <div className="review-item-header">
                      <span className="outline-num">{response.item.number}</span>
                      <div className="review-item-main">
                        <div className="review-req-row">
                          <p className="review-req-text">{response.item.requirementText}</p>
                          <span className={`review-pill ${current.toLowerCase()}`} aria-live="polite">
                            <i aria-hidden="true">{VERDICT_PILL[current]?.icon}</i>{VERDICT_PILL[current]?.label}
                          </span>
                        </div>
                        <div className="review-engineer-answer">
                          <span className={`badge ${FIELD_TONE[response.selfCheckResult] ?? 'slate'}`}>
                            Field verdict: <b>{response.selfCheckResult}</b>
                          </span>
                          {response.textValue ? (
                            <span className="badge slate">Value: {response.textValue}</span>
                          ) : null}
                          <span className={`badge ${photoCount >= (response.item.minPhotos ?? 1) && videoCount >= (response.item.minVideos ?? 0) ? 'green' : 'amber'}`}>
                            {photoCount} photo{photoCount === 1 ? '' : 's'}{videoCount > 0 ? ` · ${videoCount} video${videoCount === 1 ? '' : 's'}` : ''}
                          </span>
                        </div>
                        <Evidence files={files} />
                      </div>
                    </div>

                    <div className="review-item-actions">
                      <div className="review-segmented-control" role="group" aria-label={`Verdict for item ${response.item.number}`}>
                        <button
                          type="button"
                          className={`seg-btn pass${current === 'APPROVED' ? ' selected' : ''}`}
                          aria-pressed={current === 'APPROVED'}
                          onClick={() => setItemResult(response.itemId, 'APPROVED')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className={`seg-btn fail${current === 'REJECTED' ? ' selected' : ''}`}
                          aria-pressed={current === 'REJECTED'}
                          onClick={() => setItemResult(response.itemId, 'REJECTED')}
                        >
                          Reject
                        </button>
                        {response.item.allowsNa ? (
                          <button
                            type="button"
                            className={`seg-btn na${current === 'NA' ? ' selected' : ''}`}
                            aria-pressed={current === 'NA'}
                            onClick={() => setItemResult(response.itemId, 'NA')}
                          >
                            N/A
                          </button>
                        ) : null}
                      </div>

                      {current === 'REJECTED' ? (
                        <input
                          type="text"
                          className="review-feedback-input"
                          placeholder="What needs to be fixed?"
                          value={reviews[response.itemId]?.description ?? ''}
                          onChange={(e) => setItemDescription(response.itemId, e.target.value)}
                          required
                        />
                      ) : null}

                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="review-decision-section">
          <label htmlFor="overallComment" className="review-label">
            <span>Summary remarks</span>
            <textarea
              id="overallComment"
              name="comment"
              rows={2}
              placeholder="Overall notes for the field team (required when sending back for rework)"
              value={overallComment}
              onChange={(e) => setOverallComment(e.target.value)}
              required={decision === 'REJECT_REWORK'}
            />
          </label>

          {hasRejectedItem && decision === 'APPROVE' ? (
            <p className="form-error">
              A submission containing rejected items cannot be approved. Change decision to &quot;Reject &amp; Send for Rework&quot;.
            </p>
          ) : null}

          {state.error ? <p className="form-error">{state.error}</p> : null}

          <div className="review-submit-bar">
            {canReject ? (
              <button
                type="submit"
                className={`danger-button${decision === 'REJECT_REWORK' ? ' active-target' : ''}`}
                onClick={() => setDecision('REJECT_REWORK')}
                disabled={isPending}
              >
                Reject &amp; send for rework
              </button>
            ) : null}

            {canApprove ? (
              <button
                type="submit"
                className="primary-button qc-approve-btn"
                onClick={() => setDecision('APPROVE')}
                disabled={isPending || hasRejectedItem}
                title={hasRejectedItem ? 'Cannot approve when items are rejected' : 'Pass and mark work order completed'}
              >
                Approve work order
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </section>
  );
}
