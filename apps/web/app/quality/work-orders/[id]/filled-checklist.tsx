import type { ChecklistSection, ItemResponse, ReviewResult, SubmissionDetail, Verdict } from '../../../lib/qc-api';
import { formatDateTime } from '../labels';

type Response = SubmissionDetail['responses'][number];

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  PASS: { label: 'Pass', tone: 'green' },
  FAIL: { label: 'Fail', tone: 'red' },
  NA: { label: 'N/A', tone: 'slate' },
};

const REVIEW: Record<ReviewResult, { label: string; tone: string } | null> = {
  PENDING: null,
  APPROVED: { label: 'QC approved', tone: 'green' },
  REJECTED: { label: 'QC rejected', tone: 'red' },
  NA: { label: 'QC: N/A', tone: 'slate' },
};

const SUBMISSION_STATUS: Record<SubmissionDetail['status'], { label: string; tone: string }> = {
  SUBMITTED: { label: 'Submitted', tone: 'amber' },
  UNDER_REVIEW: { label: 'Under review', tone: 'amber' },
  APPROVED: { label: 'Approved', tone: 'green' },
  REJECTED_REWORK: { label: 'Sent back for rework', tone: 'red' },
};

/** What the engineer entered besides the verdict, if the item asks for a value. */
function value(response: ItemResponse): string | null {
  if (response.textValue) return response.textValue;
  if (response.numberValue !== null) return response.numberValue;
  if (response.booleanValue !== null) return response.booleanValue ? 'Yes' : 'No';
  return response.selectValue;
}

/**
 * The checklist as the engineer filled it in for the current attempt: every
 * answer, its value, the engineer's remark, QC's call on it, and its photos.
 * Grouped by the sections of the version the submission was made against;
 * without them (no template access) the answers are listed in item order.
 */
export function FilledChecklist({ submission, sections, name }: {
  submission: SubmissionDetail;
  sections: ChecklistSection[] | null;
  name: (id: string | null | undefined) => string;
}) {
  const status = SUBMISSION_STATUS[submission.status];
  const byItem = new Map(submission.responses.map((response) => [response.itemId, response]));
  const groups: { key: string; title: string | null; responses: Response[] }[] = sections
    ? sections
        .map((section) => ({
          key: section.id,
          title: `${section.number} ${section.title}`,
          responses: section.items.map((item) => byItem.get(item.id)).filter((r): r is Response => Boolean(r)),
        }))
        .filter((group) => group.responses.length > 0)
    : [{ key: 'all', title: null, responses: [...submission.responses].sort((a, b) => a.item.order - b.item.order) }];

  return (
    <div className="filled">
      <dl className="filled-head">
        <div><dt>Attempt</dt><dd>{submission.attemptNo}</dd></div>
        <div><dt>Status</dt><dd><span className={`state ${status.tone}`}>{status.label}</span></dd></div>
        <div><dt>Submitted</dt><dd>{formatDateTime(submission.submittedAt)} · {name(submission.submittedBy)}</dd></div>
        {submission.overallVerdict ? <div><dt>Overall</dt><dd><span className={`state ${VERDICT[submission.overallVerdict].tone}`}>{VERDICT[submission.overallVerdict].label}</span></dd></div> : null}
        {submission.reviewComment ? <div><dt>QC comment</dt><dd>{submission.reviewComment}</dd></div> : null}
      </dl>

      {groups.map((group) => (
        <section key={group.key} className="filled-section">
          {group.title ? <h3>{group.title}</h3> : null}
          <ol className="filled-items">
            {group.responses.map((response) => {
              const verdict = VERDICT[response.selfCheckResult];
              const review = REVIEW[response.reviewResult];
              const entered = value(response);
              const photos = [...response.photos].sort((a, b) => a.sequence - b.sequence);
              return (
                <li key={response.id} className={response.item.severity === 'CRITICAL' ? 'critical' : undefined}>
                  <span className="outline-num">{response.item.number}</span>
                  <div>
                    <div className="filled-row">
                      <p>{response.item.requirementText}</p>
                      <span className={`state ${verdict.tone}`}>{verdict.label}</span>
                    </div>
                    {entered ? <p className="filled-value"><b>Answer:</b> {entered}</p> : null}
                    {response.selfCheckDescription ? <p className="filled-note">{response.selfCheckDescription}</p> : null}
                    {review ? <p className="filled-review"><span className={`state ${review.tone}`}>{review.label}</span>{response.reviewDescription ? ` — ${response.reviewDescription}` : ''}</p> : null}
                    {photos.length > 0
                      ? <ul className="filled-photos" aria-label="Photos">
                          {photos.map((photo) => (
                            // Photo storage is not wired yet (media has no endpoints), so a
                            // slot stands in for each photo until there is a URL to show.
                            <li key={photo.id} title={`Photo ${photo.sequence + 1} · ${photo.mediaId}`}>
                              <span aria-hidden="true">▣</span>
                              <small>Photo {photo.sequence + 1}</small>
                            </li>
                          ))}
                        </ul>
                      : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
