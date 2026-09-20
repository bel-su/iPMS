import 'server-only';
import type { CreateSubmissionDto, CreateTemplateDto, ReviewSubmissionDto } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The QC service's public surface, reached through the gateway's `/api/v1/qc`
 * prefix. Same rules as `project-api.ts`: contracts supply the request shapes
 * as type-only imports, and the response shapes are written as the wire sees
 * them — `DateTime` as an ISO string, `Decimal` as a string.
 *
 * Written against the route table as it stands. Note that Task 1 of
 * `docs/superpowers/plans/2026-09-19-project-tracking.md` intends to remove
 * `/api/v1/qc` from the gateway until sub-project 3 rebuilds the service with
 * scope filtering; while that quarantine is in force, every call here would
 * 404 at the edge and this module should go with it.
 *
 * The expanded shapes are separate types rather than optional fields, because
 * the service is deliberate about which call returns what: listing templates
 * includes their sections, creating or publishing one does not.
 */

export type TemplateCategory = 'QUALITY' | 'EHS' | 'OTHER';
export type TemplateStatus = 'DRAFT' | 'ENABLED';
export type ResponseType = 'RESULT_ONLY' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT';
export type Verdict = 'PASS' | 'FAIL' | 'NA';
export type ReviewResult = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NA';
export type SubmissionStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED_REWORK';

export interface ChecklistItem {
  id: string; sectionId: string; number: string; requirementText: string;
  severity: 'NORMAL' | 'CRITICAL'; responseType: ResponseType;
  requiresPhoto: boolean; minPhotos: number; maxPhotos: number;
  allowsNa: boolean; isRequired: boolean; guidanceText: string | null; order: number;
}

export interface ChecklistSection {
  id: string; templateId: string; number: string; title: string; order: number;
}

export interface ChecklistTemplate {
  id: string; projectId: string; code: string; name: string;
  category: TemplateCategory;
  /** Templates are versioned per project and code; publishing never edits an existing version. */
  version: number;
  status: TemplateStatus;
  publishedAt: string | null;
  createdBy: string;
  source: string;
}

export type TemplateWithSections = ChecklistTemplate & {
  sections: (ChecklistSection & { items: ChecklistItem[] })[];
};

export interface ItemPhoto { id: string; itemResponseId: string; mediaId: string; sequence: number }

export interface ItemResponse {
  id: string; submissionId: string; itemId: string;
  selfCheckResult: Verdict; selfCheckDescription: string | null;
  textValue: string | null;
  /** Prisma Decimal, serialized by its own toJSON. */
  numberValue: string | null;
  booleanValue: boolean | null; selectValue: string | null;
  reviewResult: ReviewResult; reviewDescription: string | null;
  reviewedBy: string | null; reviewedAt: string | null;
}

export interface ReviewDecision {
  id: string; submissionId: string; reviewerId: string;
  decision: 'APPROVE' | 'REJECT_REWORK'; comment: string | null; decidedAt: string;
}

export interface Submission {
  id: string; taskId: string; siteId: string; projectId: string;
  templateId: string; templateVersion: number; attemptNo: number;
  status: SubmissionStatus; overallVerdict: Verdict | null;
  submittedBy: string; submittedAt: string | null;
  reviewedBy: string | null; reviewedAt: string | null; reviewComment: string | null;
  /** Hash over the responses, so a replayed or edited submission is detectable. */
  integrityHash: string;
  idempotencyKey: string; deviceId: string | null;
}

export type SubmissionDetail = Submission & {
  responses: (ItemResponse & { item: ChecklistItem; photos: ItemPhoto[] })[];
  decisions: ReviewDecision[];
  template: ChecklistTemplate;
};

/** Templates are listed per project; omitting the id lists every template in scope. */
export async function listTemplates(projectId?: string): Promise<ApiResult<TemplateWithSections[]>> {
  return authFetch<TemplateWithSections[]>('/api/v1/qc/templates', { query: { projectId } });
}

export async function createTemplate(template: CreateTemplateDto): Promise<ApiResult<ChecklistTemplate>> {
  return authFetch<ChecklistTemplate>('/api/v1/qc/templates', { method: 'POST', json: template });
}

export async function publishTemplate(id: string): Promise<ApiResult<ChecklistTemplate>> {
  return authFetch<ChecklistTemplate>(`/api/v1/qc/templates/${id}/publish`, { method: 'POST' });
}

export async function getSubmission(id: string): Promise<ApiResult<SubmissionDetail>> {
  return authFetch<SubmissionDetail>(`/api/v1/qc/submissions/${id}`);
}

/**
 * Typed as the plain submission, which is what a first submission returns. A
 * replay of the same `idempotencyKey` returns the expanded shape instead —
 * still a `Submission`, so this type stays true either way.
 */
export async function createSubmission(submission: CreateSubmissionDto): Promise<ApiResult<Submission>> {
  return authFetch<Submission>('/api/v1/qc/submissions', { method: 'POST', json: submission });
}

export async function reviewSubmission(id: string, review: ReviewSubmissionDto): Promise<ApiResult<Submission>> {
  return authFetch<Submission>(`/api/v1/qc/submissions/${id}/review`, { method: 'POST', json: review });
}
