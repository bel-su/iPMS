import 'server-only';
import type {
  CreateSubmissionDto, CreateTemplateDto, ImportCommitDto, ReviewSubmissionDto,
  TemplateDocumentInput, TemplateImportPreview, UpdateTemplateDto,
} from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The QC service's public surface, reached through the gateway's `/api/v1/qc`
 * prefix. Request shapes come from contracts as type-only imports; response
 * shapes are written as the wire sees them — `DateTime` as an ISO string,
 * `Decimal` as a string.
 */

export type TemplateCategory = 'QUALITY' | 'EHS' | 'OTHER';
export type ResponseType = 'RESULT_ONLY' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT';
export type Severity = 'NORMAL' | 'CRITICAL';
export type TemplateTab = 'enabled' | 'draft' | 'disabled';
export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type TemplateSource = 'WEB' | 'EXCEL_IMPORT';

export interface ChecklistTemplate {
  id: string; code: string; name: string; category: TemplateCategory;
  currentVersionId: string | null; disabledAt: string | null;
  createdBy: string; createdAt: string; updatedAt: string;
}

export interface TemplateListEntry {
  id: string; code: string; name: string; category: TemplateCategory; disabledAt: string | null;
  current: { version: number; publishedAt: string | null; publishedBy: string | null; sectionCount: number; itemCount: number; criticalCount: number } | null;
  draft: { version: number; revision: number; updatedAt: string; source: TemplateSource } | null;
}

export interface VersionSummary {
  id: string; version: number; status: VersionStatus; revision: number; source: TemplateSource;
  createdBy: string; createdAt: string; updatedAt: string;
  publishedAt: string | null; publishedBy: string | null; retiredAt: string | null;
}

export type TemplateDetail = ChecklistTemplate & { versions: VersionSummary[] };

export interface ChecklistItem {
  id: string; sectionId: string; number: string; requirementText: string;
  severity: Severity; responseType: ResponseType; selectOptions: string[];
  minPhotos: number; maxPhotos: number; allowsNa: boolean; isRequired: boolean;
  guidanceText: string | null; order: number;
}

export interface ChecklistSection { id: string; versionId: string; number: string; title: string; order: number; items: ChecklistItem[] }

export interface VersionDetail { template: ChecklistTemplate; version: VersionSummary & { templateId: string; sections: ChecklistSection[] } }

export interface DraftSummary { id: string; version: number; revision: number; source: TemplateSource; updatedAt: string }
export interface CreatedDraft { templateId: string; draft: DraftSummary }
export interface SaveDraftBody { revision: number; document: TemplateDocumentInput }
export interface ListTemplatesParams { tab: TemplateTab; category?: TemplateCategory | undefined; q?: string | undefined }

export type Verdict = 'PASS' | 'FAIL' | 'NA';
export type ReviewResult = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NA';
export type SubmissionStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED_REWORK';

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
  templateId: string; templateVersionId: string; templateVersion: number; attemptNo: number;
  status: SubmissionStatus; overallVerdict: Verdict | null;
  submittedBy: string; submittedAt: string | null;
  reviewedBy: string | null; reviewedAt: string | null; reviewComment: string | null;
  integrityHash: string; idempotencyKey: string; deviceId: string | null;
}

export type SubmissionDetail = Submission & {
  responses: (ItemResponse & { item: ChecklistItem; photos: ItemPhoto[] })[];
  decisions: ReviewDecision[];
  template: ChecklistTemplate;
};

const T = '/api/v1/qc/templates';

export async function listTemplates(params: ListTemplatesParams): Promise<ApiResult<TemplateListEntry[]>> {
  return authFetch<TemplateListEntry[]>(T, { query: { tab: params.tab, category: params.category, q: params.q } });
}

export async function getTemplate(id: string): Promise<ApiResult<TemplateDetail>> {
  return authFetch<TemplateDetail>(`${T}/${id}`);
}

export async function getVersion(id: string, version: number): Promise<ApiResult<VersionDetail>> {
  return authFetch<VersionDetail>(`${T}/${id}/versions/${version}`);
}

export async function createTemplate(dto: CreateTemplateDto): Promise<ApiResult<CreatedDraft>> {
  return authFetch<CreatedDraft>(T, { method: 'POST', json: dto });
}

export async function updateTemplate(id: string, dto: UpdateTemplateDto): Promise<ApiResult<ChecklistTemplate>> {
  return authFetch<ChecklistTemplate>(`${T}/${id}`, { method: 'PATCH', json: dto });
}

export async function startDraft(id: string): Promise<ApiResult<CreatedDraft>> {
  return authFetch<CreatedDraft>(`${T}/${id}/draft`, { method: 'POST' });
}

export async function saveDraft(id: string, body: SaveDraftBody): Promise<ApiResult<DraftSummary>> {
  return authFetch<DraftSummary>(`${T}/${id}/draft`, { method: 'PUT', json: body });
}

export async function discardDraft(id: string): Promise<ApiResult<{ templateDeleted: boolean }>> {
  return authFetch<{ templateDeleted: boolean }>(`${T}/${id}/draft`, { method: 'DELETE' });
}

export async function publishTemplate(id: string): Promise<ApiResult<VersionSummary>> {
  return authFetch<VersionSummary>(`${T}/${id}/publish`, { method: 'POST' });
}

export async function disableTemplate(id: string): Promise<ApiResult<ChecklistTemplate>> {
  return authFetch<ChecklistTemplate>(`${T}/${id}/disable`, { method: 'POST' });
}

export async function enableTemplate(id: string): Promise<ApiResult<ChecklistTemplate>> {
  return authFetch<ChecklistTemplate>(`${T}/${id}/enable`, { method: 'POST' });
}

export async function previewTemplateImport(file: File): Promise<ApiResult<TemplateImportPreview>> {
  const body = new FormData();
  body.set('file', file);
  return authFetch<TemplateImportPreview>(`${T}/import/preview`, { method: 'POST', body });
}

export async function commitTemplateImport(dto: ImportCommitDto): Promise<ApiResult<CreatedDraft>> {
  return authFetch<CreatedDraft>(`${T}/import/commit`, { method: 'POST', json: dto });
}

export async function getSubmission(id: string): Promise<ApiResult<SubmissionDetail>> {
  return authFetch<SubmissionDetail>(`/api/v1/qc/submissions/${id}`);
}

/** A replay of the same `idempotencyKey` returns the expanded shape — still a `Submission`. */
export async function createSubmission(submission: CreateSubmissionDto): Promise<ApiResult<Submission>> {
  return authFetch<Submission>('/api/v1/qc/submissions', { method: 'POST', json: submission });
}

export async function reviewSubmission(id: string, review: ReviewSubmissionDto): Promise<ApiResult<Submission>> {
  return authFetch<Submission>(`/api/v1/qc/submissions/${id}/review`, { method: 'POST', json: review });
}
