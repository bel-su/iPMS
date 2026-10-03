'use client';

import { useState } from 'react';
import { useActionStateWithToast } from '../../../components/toast';
import type { ReviewResult, SubmissionDetail } from '../../../lib/qc-api';
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
}

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

  const payloadReviews = submission.responses.map((response: SubmissionDetail['responses'][number]) => ({
    itemId: response.itemId,
    result: reviews[response.itemId]?.result ?? 'APPROVED',
    ...(reviews[response.itemId]?.description ? { description: reviews[response.itemId]?.description } : {}),
  }));

  return (
    <section className="panel review-console-panel">
      <div className="review-console-header">
        <div>
          <span className="badge amber">QC Inspection Active</span>
          <h2 className="panel-title" style={{ marginTop: '6px' }}>Review Submission #{submission.attemptNo}</h2>
          <p className="subtle">
            Verify watermarked photo proof and compliance for each requirement before issuing the final verdict.
          </p>
        </div>
      </div>

      <form action={formAction} className="review-form">
        <input type="hidden" name="submissionId" value={submission.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="workOrderId" value={workOrderId} />
        <input type="hidden" name="decision" value={decision} />
        <input type="hidden" name="itemReviews" value={JSON.stringify(payloadReviews)} />

        <div className="review-items-list">
          {submission.responses.map((response: SubmissionDetail['responses'][number]) => {
            const current = reviews[response.itemId]?.result ?? 'APPROVED';
            const files = evidence.get(response.id) ?? [];
            const photoCount = files.filter((f) => f.kind === 'PHOTO').length;
            const videoCount = files.length - photoCount;
            return (
              <div key={response.id} className={`review-item-card ${current.toLowerCase()}`}>
                <div className="review-item-header">
                  <span className="outline-num">{response.item.number}</span>
                  <div className="review-item-main">
                    <p className="review-req-text">{response.item.requirementText}</p>
                    <div className="review-engineer-answer">
                      <span className="badge subtle">
                        Field Verdict: <b>{response.selfCheckResult}</b>
                      </span>
                      {response.textValue ? (
                        <span className="badge slate">Value: {response.textValue}</span>
                      ) : null}
                      <span className={`badge ${photoCount >= (response.item.minPhotos ?? 1) && videoCount >= (response.item.minVideos ?? 0) ? 'green' : 'amber'}`}>
                        📷 {photoCount} Photo(s){videoCount > 0 ? ` · ${videoCount} Video(s)` : ''} Attached
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
                      onClick={() => setItemResult(response.itemId, 'APPROVED')}
                    >
                      ✓ Approve
                    </button>
                    <button
                      type="button"
                      className={`seg-btn fail${current === 'REJECTED' ? ' selected' : ''}`}
                      onClick={() => setItemResult(response.itemId, 'REJECTED')}
                    >
                      ✕ Reject
                    </button>
                    {response.item.allowsNa ? (
                      <button
                        type="button"
                        className={`seg-btn na${current === 'NA' ? ' selected' : ''}`}
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
                      placeholder="Specify rejection reason or required rework..."
                      value={reviews[response.itemId]?.description ?? ''}
                      onChange={(e) => setItemDescription(response.itemId, e.target.value)}
                      required
                    />
                  ) : null}

                  {current === 'APPROVED' ? (
                    <p className="review-approved-note">✓ Approved — no remarks needed</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="review-decision-section">
          <label htmlFor="overallComment" className="review-label">
            QC Inspector Summary Remarks:
            <textarea
              id="overallComment"
              name="comment"
              rows={2}
              placeholder="Provide overall quality audit notes or rework instructions for the field team..."
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
                ✕ Reject &amp; Send for Rework
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
                ✓ Approve Work Order
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </section>
  );
}
