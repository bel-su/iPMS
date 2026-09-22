# QC Template Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn QC checklist templates into a company-wide, versioned library with a web editor, an Excel round-trip, a task-scoped checklist endpoint for field engineers, and the Template Management web screens.

**Architecture:** The `qc` service (NestJS + Fastify + Prisma 7) splits templates into a stable `ChecklistTemplate` and immutable `TemplateVersion`s. A draft is edited as one whole document (`TemplateDocument`), validated by one shared Zod schema in `@ipms/contracts` that both the web editor and the Excel importer go through. Lifecycle actions write audit events to a transactional outbox, drained to NATS exactly as `iam` does. The Next.js web console gets `/quality/templates/*` screens built with server components and server actions.

**Tech Stack:** TypeScript 5.9 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), NestJS 12 on Fastify 5, Prisma 7 with `@prisma/adapter-pg`, Zod 4, exceljs 4.4.0, Vitest 4, Testcontainers (`postgres:17-alpine`), Next.js 16 / React 19, pnpm workspaces + Nx.

**Spec:** `docs/superpowers/specs/2026-09-22-qc-template-management-design.md`

## Global Constraints

- Templates have no `projectId`; `code` is unique company-wide and immutable; regex `^[A-Z0-9_-]+$`, 1–50 chars.
- Version status vocabulary: `DRAFT | PUBLISHED | RETIRED`. Source vocabulary: `WEB | EXCEL_IMPORT`. Category: `QUALITY | EHS | OTHER`. Severity: `NORMAL | CRITICAL`. Response type: `RESULT_ONLY | TEXT | NUMBER | BOOLEAN | SELECT`.
- At most one `DRAFT` and one `PUBLISHED` version per template (partial unique indexes).
- Limits: 100 sections, 1,000 items per document; `.xlsx` only, 5 MB (5_242_880 bytes); Select items 2–50 options, each 1–100 chars, unique case-insensitively, no `;`.
- Retired-version grace window: env `QC_RETIRED_VERSION_GRACE_DAYS`, default `7`; accepted when `retiredAt > now − grace`.
- Validation failures answer **422** `VALIDATION_FAILED` with `details` keyed by dotted path (the platform's `GlobalExceptionFilter` renders a thrown `ZodError` this way). Conflicts are 409 via `ConflictException`.
- Library-changing routes require `qc_template.create | update | publish | import` (by permission only). After Task 11 only `QC_MANAGER` and `SUPER_ADMIN` hold them.
- Every `@ipms/*` library is consumed as a built package: after changing `libs/contracts`, run `pnpm --filter @ipms/contracts build` before dependants typecheck or test.
- Prisma client for qc is generated to `apps/qc/node_modules/@prisma-clients/qc`: after editing `apps/qc/prisma/schema.prisma`, run `pnpm --filter qc prisma:generate`.
- Web client components never import runtime values from `@ipms/contracts` (it would pull zod and `node:crypto` into the browser bundle); type-only imports are fine.
- No new comments that restate code; one short line only where the *why* is non-obvious.
- Commit messages follow the repo style (`feat(qc): …`, `test(qc): …`, `feat(web): …`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

**`libs/contracts`**
- Create `src/qc/template.ts` — template document schema, request schemas, import preview types. One responsibility: the template wire contract.
- Modify `src/qc/qc.ts` — submissions/review only; `CreateSubmissionSchema` takes `templateVersionId`.
- Modify `src/index.ts` — export `./qc/template.js`.
- Create `src/qc/template.spec.ts`.

**`apps/qc`**
- Modify `prisma/schema.prisma`; create `prisma/migrations/20260922000100_template_library/migration.sql`.
- Create `prisma/test-db.ts` (Testcontainers helper) and `prisma/fixtures.ts` (published-template fixture) for integration specs.
- Delete `src/qc/` (split below).
- `src/submissions/` — `submission.controller.ts`, `submission.service.ts`, `version-acceptance.ts` (+ spec), `site-geofence.client.ts` (+ spec, moved unchanged).
- `src/templates/` — `document.ts` (tree ↔ document, tree writes), `audit.ts` (outbox audit helper), `template.service.ts` (lifecycle writes), `template.queries.ts` (reads), `template.controller.ts`, `template-import.controller.ts`, `template-import.service.ts`.
- `src/templates/excel/` — `columns.ts`, `workbook.ts`, `parse.ts` (+ specs).
- `src/tasks/` — `task-lookup.client.ts` (+ spec), `task-checklist.controller.ts` (+ spec).
- `src/outbox/outbox.drainer.ts` (+ spec).
- Modify `src/app.module.ts`, `src/main.ts`, `package.json`, `vitest.config.ts`.
- Integration specs in `prisma/*.integration.spec.ts`.

**`apps/project`** — add `internalTask` to `project.service.ts` and `GET internal/tasks/:id` to `project.controller.ts`.

**`apps/iam`** — `prisma/seed.ts` role permissions; assertions in `prisma/seed.integration.spec.ts`.

**`apps/web`**
- Modify `app/lib/api-client.ts` (keep validation `details`), rewrite `app/lib/qc-api.ts` (+ spec), create `app/lib/download.ts`.
- Modify `app/shell.tsx`, `app/styles.css`.
- Create `app/api/qc/templates/blank/route.ts`, `app/api/qc/templates/[id]/versions/[version]/export/route.ts`.
- Create `app/quality/templates/` — `labels.ts`, `actions.ts` (+ spec), `forms.tsx`, `version-view.tsx`, `page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/versions/[version]/page.tsx`, `import/page.tsx`, `import/import-form.tsx`, `import/actions.ts` (+ spec), `[id]/draft/page.tsx`, `[id]/draft/draft-editor.tsx`, `[id]/draft/editor-state.ts` (+ spec), `[id]/draft/actions.ts` (+ spec).

**Other** — `docker/env/qc.env`, `.env.example`, `e2e/qc-templates.e2e.spec.ts`.

---

### Task 1: Template contracts

**Files:**
- Create: `libs/contracts/src/qc/template.ts`
- Create: `libs/contracts/src/qc/template.spec.ts`
- Modify: `libs/contracts/src/qc/qc.ts`
- Modify: `libs/contracts/src/index.ts`

**Interfaces:**
- Produces (all exported from `@ipms/contracts`):
  - Schemas: `TemplateCategorySchema`, `ResponseTypeSchema`, `SeveritySchema`, `TemplateCodeSchema`, `TemplateItemInputSchema`, `TemplateSectionInputSchema`, `TemplateDocumentSchema`, `PublishableDocumentSchema`, `CreateTemplateSchema`, `UpdateTemplateSchema`, `SaveDraftSchema`, `ImportCommitSchema`, `TemplateTabSchema`, `ListTemplatesQuerySchema`, `VersionNumberSchema`.
  - Constants: `TEMPLATE_MAX_SECTIONS = 100`, `TEMPLATE_MAX_ITEMS = 1000`, `TEMPLATE_IMPORT_FILE_BYTES = 5_242_880`.
  - Types: `TemplateCategory`, `ResponseType`, `Severity`, `TemplateDocument` (Zod output), `TemplateDocumentInput` (Zod input), `CreateTemplateDto`, `UpdateTemplateDto`, `SaveDraftDto`, `ImportCommitDto`, `ListTemplatesQueryDto`, `ImportRowError`, `ImportTarget`, `TemplateImportPreview`, `TemplateMetadata`.
  - `CreateSubmissionSchema` / `CreateSubmissionDto` now carry `templateVersionId` instead of `templateId`.

- [ ] **Step 1: Write the failing test**

Create `libs/contracts/src/qc/template.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CreateTemplateSchema, ImportCommitSchema, ListTemplatesQuerySchema, PublishableDocumentSchema,
  SaveDraftSchema, TemplateDocumentSchema, UpdateTemplateSchema,
} from './template.js';

const item = (over: Record<string, unknown> = {}) => ({ number: '1.1', requirementText: 'PPE worn', ...over });
const doc = (items: unknown[] = [item()]) => ({ sections: [{ number: '1', title: 'EHS', items }] });

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('TemplateDocumentSchema — save rules', () => {
  it('applies item defaults', () => {
    const parsed = TemplateDocumentSchema.parse(doc());
    expect(parsed.sections[0]!.items[0]).toEqual({
      number: '1.1', requirementText: 'PPE worn', severity: 'NORMAL', responseType: 'RESULT_ONLY',
      selectOptions: [], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true,
    });
  });

  it('accepts an empty document and an empty section, so a half-built draft can be saved', () => {
    expect(TemplateDocumentSchema.safeParse({ sections: [] }).success).toBe(true);
    expect(TemplateDocumentSchema.safeParse(doc([])).success).toBe(true);
  });

  it('refuses max photos below min photos, at the item field', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ minPhotos: 2, maxPhotos: 1 })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.maxPhotos']);
  });

  it('needs 2 to 50 options on a Select item', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ responseType: 'SELECT', selectOptions: ['Pole'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses duplicate options case-insensitively', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ responseType: 'SELECT', selectOptions: ['Pole', 'pole'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses an option containing the Excel separator', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ responseType: 'SELECT', selectOptions: ['Pole; Wall', 'Tower'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses options on an item that is not a Select', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item({ selectOptions: ['A', 'B'] })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.selectOptions']);
  });

  it('refuses a section number used twice', () => {
    const result = TemplateDocumentSchema.safeParse({
      sections: [{ number: '1', title: 'A', items: [] }, { number: '1', title: 'B', items: [] }],
    });
    expect(issuePaths(result)).toEqual(['sections.1.number']);
  });

  it('refuses an item number used twice within its section', () => {
    const result = TemplateDocumentSchema.safeParse(doc([item(), item()]));
    expect(issuePaths(result)).toEqual(['sections.0.items.1.number']);
  });

  it('allows the same item number in different sections', () => {
    const result = TemplateDocumentSchema.safeParse({
      sections: [{ number: '1', title: 'A', items: [item()] }, { number: '2', title: 'B', items: [item()] }],
    });
    expect(result.success).toBe(true);
  });

  it('refuses more than 1,000 items in total', () => {
    const many = Array.from({ length: 501 }, (_, i) => item({ number: String(i) }));
    const result = TemplateDocumentSchema.safeParse({
      sections: [{ number: '1', title: 'A', items: many }, { number: '2', title: 'B', items: many }],
    });
    expect(issuePaths(result)).toEqual(['sections']);
  });
});

describe('PublishableDocumentSchema — publish rules', () => {
  it('needs at least one section', () => {
    expect(issuePaths(PublishableDocumentSchema.safeParse({ sections: [] }))).toEqual(['sections']);
  });

  it('needs an item in every section', () => {
    expect(issuePaths(PublishableDocumentSchema.safeParse(doc([])))).toEqual(['sections.0.items']);
  });

  it('still applies the save rules', () => {
    const result = PublishableDocumentSchema.safeParse(doc([item({ minPhotos: 3, maxPhotos: 0 })]));
    expect(issuePaths(result)).toEqual(['sections.0.items.0.maxPhotos']);
  });
});

describe('request schemas', () => {
  it('upper-case codes only', () => {
    expect(CreateTemplateSchema.safeParse({ code: 'ai-rru', name: 'X', category: 'QUALITY' }).success).toBe(false);
    expect(CreateTemplateSchema.parse({ code: 'AI-RRU_1', name: ' Antenna ', category: 'EHS' }))
      .toEqual({ code: 'AI-RRU_1', name: 'Antenna', category: 'EHS' });
  });

  it('an update must change something', () => {
    expect(UpdateTemplateSchema.safeParse({}).success).toBe(false);
    expect(UpdateTemplateSchema.parse({ name: 'New' })).toEqual({ name: 'New' });
  });

  it('a draft save carries a revision', () => {
    expect(SaveDraftSchema.safeParse({ document: { sections: [] } }).success).toBe(false);
    expect(SaveDraftSchema.parse({ revision: 3, document: { sections: [] } }).revision).toBe(3);
  });

  it('an import commit must be publishable', () => {
    expect(ImportCommitSchema.safeParse({ code: 'A', name: 'A', category: 'QUALITY', document: { sections: [] } }).success).toBe(false);
  });

  it('the list defaults to the enabled tab', () => {
    expect(ListTemplatesQuerySchema.parse({})).toEqual({ tab: 'enabled' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ipms/contracts exec vitest run src/qc/template.spec.ts`
Expected: FAIL — `Cannot find module './template.js'`.

- [ ] **Step 3: Write the contract**

Create `libs/contracts/src/qc/template.ts`:

```ts
import { z } from 'zod';

export const TEMPLATE_MAX_SECTIONS = 100;
export const TEMPLATE_MAX_ITEMS = 1000;
export const TEMPLATE_IMPORT_FILE_BYTES = 5_242_880;

export const TemplateCategorySchema = z.enum(['QUALITY', 'EHS', 'OTHER']);
export const ResponseTypeSchema = z.enum(['RESULT_ONLY', 'TEXT', 'NUMBER', 'BOOLEAN', 'SELECT']);
export const SeveritySchema = z.enum(['NORMAL', 'CRITICAL']);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;
export type ResponseType = z.infer<typeof ResponseTypeSchema>;
export type Severity = z.infer<typeof SeveritySchema>;

export const TemplateCodeSchema = z.string().trim().min(1).max(50)
  .regex(/^[A-Z0-9_-]+$/, 'Use upper case letters, digits, dash or underscore');

export const TemplateItemInputSchema = z.object({
  number: z.string().trim().min(1).max(30),
  requirementText: z.string().trim().min(1).max(5000),
  severity: SeveritySchema.default('NORMAL'),
  responseType: ResponseTypeSchema.default('RESULT_ONLY'),
  selectOptions: z.array(z.string().trim().min(1).max(100)).default([]),
  minPhotos: z.number().int().min(0).max(20).default(0),
  maxPhotos: z.number().int().min(0).max(20).default(0),
  allowsNa: z.boolean().default(false),
  isRequired: z.boolean().default(true),
  guidanceText: z.string().trim().max(2000).optional(),
}).strip();

export const TemplateSectionInputSchema = z.object({
  number: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(300),
  items: z.array(TemplateItemInputSchema),
}).strip();

type ParsedItem = z.infer<typeof TemplateItemInputSchema>;
type ParsedSection = z.infer<typeof TemplateSectionInputSchema>;

function checkItem(item: ParsedItem, path: (string | number)[], ctx: z.RefinementCtx): void {
  if (item.maxPhotos < item.minPhotos) {
    ctx.addIssue({ code: 'custom', path: [...path, 'maxPhotos'], message: `Must be at least Min Photos (${item.minPhotos})` });
  }
  if (item.responseType !== 'SELECT') {
    if (item.selectOptions.length > 0) {
      ctx.addIssue({ code: 'custom', path: [...path, 'selectOptions'], message: 'Only Select items have options' });
    }
    return;
  }
  const options = item.selectOptions;
  let problem: string | null = null;
  if (options.length < 2 || options.length > 50) problem = 'A Select item needs 2 to 50 options';
  else if (options.some((option) => option.includes(';'))) problem = 'Options cannot contain ";"';
  else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) problem = 'Options must be unique';
  if (problem) ctx.addIssue({ code: 'custom', path: [...path, 'selectOptions'], message: problem });
}

function checkDocument(doc: { sections: ParsedSection[] }, ctx: z.RefinementCtx): void {
  const total = doc.sections.reduce((sum, section) => sum + section.items.length, 0);
  if (total > TEMPLATE_MAX_ITEMS) {
    ctx.addIssue({ code: 'custom', path: ['sections'], message: `A template can hold at most ${TEMPLATE_MAX_ITEMS} items` });
  }
  const sectionNumbers = new Set<string>();
  doc.sections.forEach((section, s) => {
    if (sectionNumbers.has(section.number)) {
      ctx.addIssue({ code: 'custom', path: ['sections', s, 'number'], message: `Section number ${section.number} is used twice` });
    }
    sectionNumbers.add(section.number);
    const itemNumbers = new Set<string>();
    section.items.forEach((item, i) => {
      if (itemNumbers.has(item.number)) {
        ctx.addIssue({ code: 'custom', path: ['sections', s, 'items', i, 'number'], message: `Item number ${item.number} is used twice in this section` });
      }
      itemNumbers.add(item.number);
      checkItem(item, ['sections', s, 'items', i], ctx);
    });
  });
}

export const TemplateDocumentSchema = z.object({
  sections: z.array(TemplateSectionInputSchema).max(TEMPLATE_MAX_SECTIONS),
}).strip().superRefine(checkDocument);

export const PublishableDocumentSchema = TemplateDocumentSchema.superRefine((doc, ctx) => {
  if (doc.sections.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Add at least one section' });
  }
  doc.sections.forEach((section, s) => {
    if (section.items.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['sections', s, 'items'], message: 'Every section needs at least one item' });
    }
  });
});

export type TemplateDocument = z.infer<typeof TemplateDocumentSchema>;
export type TemplateDocumentInput = z.input<typeof TemplateDocumentSchema>;

const NameSchema = z.string().trim().min(1).max(250);

export const CreateTemplateSchema = z.object({
  code: TemplateCodeSchema, name: NameSchema, category: TemplateCategorySchema,
}).strip();
export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;
export type TemplateMetadata = CreateTemplateDto;

export const UpdateTemplateSchema = z.object({
  name: NameSchema.optional(), category: TemplateCategorySchema.optional(),
}).strip().refine((dto) => dto.name !== undefined || dto.category !== undefined, { message: 'Nothing to update' });
export type UpdateTemplateDto = z.infer<typeof UpdateTemplateSchema>;

export const SaveDraftSchema = z.object({
  revision: z.number().int().min(1),
  document: TemplateDocumentSchema,
}).strip();
export type SaveDraftDto = z.infer<typeof SaveDraftSchema>;

export const ImportCommitSchema = z.object({
  code: TemplateCodeSchema, name: NameSchema, category: TemplateCategorySchema,
  document: PublishableDocumentSchema,
  expectedDraftRevision: z.number().int().min(1).optional(),
}).strip();
export type ImportCommitDto = z.infer<typeof ImportCommitSchema>;

export const TemplateTabSchema = z.enum(['enabled', 'draft', 'disabled']);
export const ListTemplatesQuerySchema = z.object({
  tab: TemplateTabSchema.default('enabled'),
  category: TemplateCategorySchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
}).strip();
export type ListTemplatesQueryDto = z.infer<typeof ListTemplatesQuerySchema>;

export const VersionNumberSchema = z.coerce.number().int().min(1);

export interface ImportRowError { row: number | null; column: string | null; message: string }

export type ImportTarget =
  | { kind: 'NEW' }
  | {
      kind: 'EXISTING'; templateId: string; name: string; category: TemplateCategory;
      replacesDraft: { version: number; revision: number } | null; nextVersion: number;
    };

export interface TemplateImportPreview {
  metadata: TemplateMetadata | null;
  target: ImportTarget | null;
  warnings: string[];
  errors: ImportRowError[];
  document: TemplateDocument | null;
  summary: { sections: number; items: number; critical: number; withPhotos: number } | null;
}
```

Replace `libs/contracts/src/qc/qc.ts` with (template schemas move out; submissions take a version id; `requiresPhoto` is gone from the model):

```ts
import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const VerdictSchema = z.enum(['PASS', 'FAIL', 'NA']);

export const ItemResponseInputSchema = z.object({
  itemId: UuidSchema, selfCheckResult: VerdictSchema, selfCheckDescription: z.string().max(5000).optional(), textValue: z.string().max(5000).optional(), numberValue: z.number().optional(), booleanValue: z.boolean().optional(), selectValue: z.string().max(500).optional(), photoMediaIds: z.array(UuidSchema).max(20).default([]),
}).strip();
export const CreateSubmissionSchema = z.object({ taskId: UuidSchema, siteId: UuidSchema, projectId: UuidSchema, templateVersionId: UuidSchema, idempotencyKey: z.string().trim().min(8).max(255), deviceId: z.string().max(255).optional(), latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(), responses: z.array(ItemResponseInputSchema).min(1) }).strip();
export type CreateSubmissionDto = z.infer<typeof CreateSubmissionSchema>;
export const ReviewSubmissionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT_REWORK']), comment: z.string().trim().max(5000).optional(), itemReviews: z.array(z.object({ itemId: UuidSchema, result: z.enum(['APPROVED', 'REJECTED', 'NA']), description: z.string().max(5000).optional() })).min(1) }).refine((data) => data.decision === 'APPROVE' || Boolean(data.comment), { message: 'A rework decision requires a comment', path: ['comment'] });
export type ReviewSubmissionDto = z.infer<typeof ReviewSubmissionSchema>;
```

In `libs/contracts/src/index.ts`, add after the `qc/qc.js` line:

```ts
export * from './qc/template.js';
```

- [ ] **Step 4: Run the tests and build**

Run: `pnpm --filter @ipms/contracts exec vitest run && pnpm --filter @ipms/contracts build`
Expected: all contract tests PASS; build succeeds.

Note: `pnpm --filter qc typecheck` and `pnpm --filter web typecheck` now fail — `qc` still uses the removed per-project `CreateTemplateSchema`, and the web spec fixture uses `templateId`. Task 2 fixes `qc`; fix the web fixture now: in `apps/web/app/lib/qc-api.spec.ts` change `templateId: 'tpl-1'` in `SUBMISSION` to `templateVersionId: 'tv-1'`. (The rest of that spec is replaced in Task 14.)

- [ ] **Step 5: Commit**

```bash
git add libs/contracts/src/qc libs/contracts/src/index.ts apps/web/app/lib/qc-api.spec.ts
git commit -m "feat(contracts): add the company-wide QC template contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rebuild the qc schema; submissions reference a version

The migration is destructive by decision (spec T9). The existing template routes are removed here and come back as the new template controller in Task 6; submissions keep working throughout.

**Files:**
- Modify: `apps/qc/prisma/schema.prisma`
- Create: `apps/qc/prisma/migrations/20260922000100_template_library/migration.sql`
- Modify: `apps/qc/package.json`, `apps/qc/vitest.config.ts`
- Create: `apps/qc/prisma/test-db.ts`, `apps/qc/prisma/fixtures.ts`
- Create: `apps/qc/prisma/schema.integration.spec.ts`
- Move: `apps/qc/src/qc/site-geofence.client.ts` → `apps/qc/src/submissions/site-geofence.client.ts` (and its spec)
- Create: `apps/qc/src/submissions/version-acceptance.ts`, `version-acceptance.spec.ts`
- Create: `apps/qc/src/submissions/submission.service.ts`, `submission.controller.ts`
- Delete: `apps/qc/src/qc/qc.controller.ts`, `apps/qc/src/qc/qc.service.ts`
- Modify: `apps/qc/src/app.module.ts`
- Create: `apps/qc/prisma/submission.integration.spec.ts`

**Interfaces:**
- Consumes: `CreateSubmissionDto` (with `templateVersionId`), `ReviewSubmissionDto` from Task 1.
- Produces:
  - Prisma models `ChecklistTemplate`, `TemplateVersion`, `ChecklistSection` (`versionId`), `ChecklistItem` (`selectOptions: string[]`, no `requiresPhoto`), `Submission` (`templateVersionId`), `OutboxEvent`.
  - `startTestDb(): Promise<{ prisma: PrismaClient; stop(): Promise<void> }>` in `prisma/test-db.ts`.
  - `resetDb(prisma: PrismaClient): Promise<void>` and `seedPublishedTemplate(prisma, opts?: { code?: string; status?: 'PUBLISHED' | 'RETIRED'; retiredAt?: Date | null; disabled?: boolean }): Promise<{ templateId: string; versionId: string; itemId: string }>` in `prisma/fixtures.ts`.
  - `acceptVersion(version: { status: string; retiredAt: Date | null }, template: { disabledAt: Date | null }, now: Date, graceDays: number): VersionAcceptance` where `VersionAcceptance = { ok: true } | { ok: false; reason: 'DISABLED' | 'NOT_PUBLISHED' | 'SUPERSEDED' }`.
  - `class SubmissionService { constructor(prisma: PrismaClient, geofence: SiteGeofenceClient, graceDays: number); getSubmission(id); createSubmission(dto, actorId, bearer); reviewSubmission(id, dto, actorId) }`.

- [ ] **Step 1: Add dependencies and integration-test wiring**

In `apps/qc/package.json` add to `dependencies`:

```json
    "@fastify/multipart": "10.1.1",
    "@ipms/events": "workspace:*",
    "exceljs": "4.4.0",
    "fastify": "5.12.4",
```

and to `devDependencies`:

```json
    "@testcontainers/postgresql": "12.1.0",
```

Replace `apps/qc/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    // Resolves DOCKER_HOST for Testcontainers on a fresh clone and in CI.
    setupFiles: ['../../tools/vitest-setup-containers.ts'],
  },
});
```

Run: `pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 2: Rewrite the Prisma schema**

Replace `apps/qc/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/@prisma-clients/qc"
}

datasource db {
  provider = "postgresql"
}

model ChecklistTemplate {
  id               String            @id @db.Uuid
  code             String            @unique @db.VarChar(50)
  name             String            @db.VarChar(250)
  category         String            @db.VarChar(20)
  currentVersionId String?           @unique @db.Uuid
  disabledAt       DateTime?         @db.Timestamptz(6)
  createdBy        String            @db.Uuid
  createdAt        DateTime          @default(now()) @db.Timestamptz(6)
  updatedAt        DateTime          @updatedAt @db.Timestamptz(6)
  currentVersion   TemplateVersion?  @relation("CurrentVersion", fields: [currentVersionId], references: [id], onDelete: SetNull)
  versions         TemplateVersion[] @relation("TemplateVersions")
  submissions      Submission[]

  @@map("checklist_template")
}

model TemplateVersion {
  id          String             @id @db.Uuid
  templateId  String             @db.Uuid
  version     Int
  status      String             @db.VarChar(20)
  revision    Int                @default(1)
  source      String             @db.VarChar(20)
  createdBy   String             @db.Uuid
  createdAt   DateTime           @default(now()) @db.Timestamptz(6)
  updatedAt   DateTime           @updatedAt @db.Timestamptz(6)
  publishedAt DateTime?          @db.Timestamptz(6)
  publishedBy String?            @db.Uuid
  retiredAt   DateTime?          @db.Timestamptz(6)
  template    ChecklistTemplate  @relation("TemplateVersions", fields: [templateId], references: [id], onDelete: Cascade)
  currentOf   ChecklistTemplate? @relation("CurrentVersion")
  sections    ChecklistSection[]
  submissions Submission[]

  @@unique([templateId, version])
  @@map("template_version")
}

model ChecklistSection {
  id        String          @id @db.Uuid
  versionId String          @db.Uuid
  number    String          @db.VarChar(30)
  title     String          @db.VarChar(300)
  order     Int
  version   TemplateVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  items     ChecklistItem[]

  @@unique([versionId, number])
  @@map("checklist_section")
}

model ChecklistItem {
  id              String           @id @db.Uuid
  sectionId       String           @db.Uuid
  number          String           @db.VarChar(30)
  requirementText String           @db.Text
  severity        String           @db.VarChar(20)
  responseType    String           @db.VarChar(20)
  selectOptions   String[]         @default([])
  minPhotos       Int              @default(0)
  maxPhotos       Int              @default(0)
  allowsNa        Boolean          @default(false)
  isRequired      Boolean          @default(true)
  guidanceText    String?          @db.Text
  order           Int
  section         ChecklistSection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  responses       ItemResponse[]

  @@unique([sectionId, number])
  @@map("checklist_item")
}

model Submission {
  id                String            @id @db.Uuid
  taskId            String            @db.Uuid
  siteId            String            @db.Uuid
  projectId         String            @db.Uuid
  templateId        String            @db.Uuid
  templateVersionId String            @db.Uuid
  templateVersion   Int
  attemptNo         Int
  status            String            @db.VarChar(30)
  overallVerdict    String?           @db.VarChar(10)
  submittedBy       String            @db.Uuid
  submittedAt       DateTime?         @db.Timestamptz(6)
  reviewedBy        String?           @db.Uuid
  reviewedAt        DateTime?         @db.Timestamptz(6)
  reviewComment     String?           @db.Text
  integrityHash     String            @db.VarChar(64)
  idempotencyKey    String            @unique @db.VarChar(255)
  deviceId          String?           @db.VarChar(255)
  latitude          Decimal?          @db.Decimal(10, 7)
  longitude         Decimal?          @db.Decimal(10, 7)
  distanceFromSiteM Int?
  geofenceStatus    String            @default("NOT_APPLICABLE") @db.VarChar(20)
  template          ChecklistTemplate @relation(fields: [templateId], references: [id])
  version           TemplateVersion   @relation(fields: [templateVersionId], references: [id])
  responses         ItemResponse[]
  decisions         ReviewDecision[]

  @@unique([taskId, attemptNo])
  @@map("submission")
}

model ItemResponse {
  id                   String        @id @db.Uuid
  submissionId         String        @db.Uuid
  itemId               String        @db.Uuid
  selfCheckResult      String        @db.VarChar(10)
  selfCheckDescription String?       @db.Text
  textValue            String?       @db.Text
  numberValue          Decimal?      @db.Decimal(18, 4)
  booleanValue         Boolean?
  selectValue          String?       @db.VarChar(500)
  reviewResult         String        @default("PENDING") @db.VarChar(20)
  reviewDescription    String?       @db.Text
  reviewedBy           String?       @db.Uuid
  reviewedAt           DateTime?     @db.Timestamptz(6)
  submission           Submission    @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  item                 ChecklistItem @relation(fields: [itemId], references: [id])
  photos               ItemPhoto[]

  @@unique([submissionId, itemId])
  @@map("item_response")
}

model ItemPhoto {
  id             String       @id @db.Uuid
  itemResponseId String       @db.Uuid
  mediaId        String       @db.Uuid
  sequence       Int
  itemResponse   ItemResponse @relation(fields: [itemResponseId], references: [id], onDelete: Cascade)

  @@unique([itemResponseId, sequence])
  @@map("item_photo")
}

model ReviewDecision {
  id           String     @id @db.Uuid
  submissionId String     @db.Uuid
  reviewerId   String     @db.Uuid
  decision     String     @db.VarChar(30)
  comment      String?    @db.Text
  decidedAt    DateTime   @default(now()) @db.Timestamptz(6)
  submission   Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)

  @@map("review_decision")
}

model OutboxEvent {
  id            String    @id @db.Uuid
  subject       String    @db.VarChar(100)
  payload       Json
  correlationId String    @db.VarChar(64)
  actorId       String?   @db.Uuid
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  publishedAt   DateTime? @db.Timestamptz(6)

  @@index([publishedAt, createdAt])
  @@map("outbox_event")
}
```

- [ ] **Step 3: Write the migration**

Create `apps/qc/prisma/migrations/20260922000100_template_library/migration.sql`:

```sql
-- Destructive by design: qc has never held production data (spec T9).
DROP TABLE IF EXISTS "review_decision", "item_photo", "item_response", "submission",
  "checklist_item", "checklist_section", "checklist_template" CASCADE;

CREATE TABLE "checklist_template" (
  "id" uuid PRIMARY KEY,
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(250) NOT NULL,
  "category" varchar(20) NOT NULL,
  "currentVersionId" uuid UNIQUE,
  "disabledAt" timestamptz(6),
  "createdBy" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(6) NOT NULL
);

CREATE TABLE "template_version" (
  "id" uuid PRIMARY KEY,
  "templateId" uuid NOT NULL REFERENCES "checklist_template"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" varchar(20) NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "source" varchar(20) NOT NULL,
  "createdBy" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(6) NOT NULL,
  "publishedAt" timestamptz(6),
  "publishedBy" uuid,
  "retiredAt" timestamptz(6),
  UNIQUE ("templateId", "version")
);

-- Prisma cannot express partial unique indexes; these are the lifecycle's backstop.
CREATE UNIQUE INDEX "template_version_one_draft" ON "template_version" ("templateId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "template_version_one_published" ON "template_version" ("templateId") WHERE "status" = 'PUBLISHED';

ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "template_version"("id") ON DELETE SET NULL;

CREATE TABLE "checklist_section" (
  "id" uuid PRIMARY KEY,
  "versionId" uuid NOT NULL REFERENCES "template_version"("id") ON DELETE CASCADE,
  "number" varchar(30) NOT NULL,
  "title" varchar(300) NOT NULL,
  "order" integer NOT NULL,
  UNIQUE ("versionId", "number")
);

CREATE TABLE "checklist_item" (
  "id" uuid PRIMARY KEY,
  "sectionId" uuid NOT NULL REFERENCES "checklist_section"("id") ON DELETE CASCADE,
  "number" varchar(30) NOT NULL,
  "requirementText" text NOT NULL,
  "severity" varchar(20) NOT NULL,
  "responseType" varchar(20) NOT NULL,
  "selectOptions" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "minPhotos" integer NOT NULL DEFAULT 0,
  "maxPhotos" integer NOT NULL DEFAULT 0,
  "allowsNa" boolean NOT NULL DEFAULT false,
  "isRequired" boolean NOT NULL DEFAULT true,
  "guidanceText" text,
  "order" integer NOT NULL,
  UNIQUE ("sectionId", "number")
);

CREATE TABLE "submission" (
  "id" uuid PRIMARY KEY,
  "taskId" uuid NOT NULL,
  "siteId" uuid NOT NULL,
  "projectId" uuid NOT NULL,
  "templateId" uuid NOT NULL REFERENCES "checklist_template"("id"),
  "templateVersionId" uuid NOT NULL REFERENCES "template_version"("id"),
  "templateVersion" integer NOT NULL,
  "attemptNo" integer NOT NULL,
  "status" varchar(30) NOT NULL,
  "overallVerdict" varchar(10),
  "submittedBy" uuid NOT NULL,
  "submittedAt" timestamptz(6),
  "reviewedBy" uuid,
  "reviewedAt" timestamptz(6),
  "reviewComment" text,
  "integrityHash" varchar(64) NOT NULL,
  "idempotencyKey" varchar(255) NOT NULL UNIQUE,
  "deviceId" varchar(255),
  "latitude" decimal(10,7),
  "longitude" decimal(10,7),
  "distanceFromSiteM" integer,
  "geofenceStatus" varchar(20) NOT NULL DEFAULT 'NOT_APPLICABLE',
  UNIQUE ("taskId", "attemptNo")
);

CREATE TABLE "item_response" (
  "id" uuid PRIMARY KEY,
  "submissionId" uuid NOT NULL REFERENCES "submission"("id") ON DELETE CASCADE,
  "itemId" uuid NOT NULL REFERENCES "checklist_item"("id"),
  "selfCheckResult" varchar(10) NOT NULL,
  "selfCheckDescription" text,
  "textValue" text,
  "numberValue" decimal(18,4),
  "booleanValue" boolean,
  "selectValue" varchar(500),
  "reviewResult" varchar(20) NOT NULL DEFAULT 'PENDING',
  "reviewDescription" text,
  "reviewedBy" uuid,
  "reviewedAt" timestamptz(6),
  UNIQUE ("submissionId", "itemId")
);

CREATE TABLE "item_photo" (
  "id" uuid PRIMARY KEY,
  "itemResponseId" uuid NOT NULL REFERENCES "item_response"("id") ON DELETE CASCADE,
  "mediaId" uuid NOT NULL,
  "sequence" integer NOT NULL,
  UNIQUE ("itemResponseId", "sequence")
);

CREATE TABLE "review_decision" (
  "id" uuid PRIMARY KEY,
  "submissionId" uuid NOT NULL REFERENCES "submission"("id") ON DELETE CASCADE,
  "reviewerId" uuid NOT NULL,
  "decision" varchar(30) NOT NULL,
  "comment" text,
  "decidedAt" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE "outbox_event" (
  "id" uuid PRIMARY KEY,
  "subject" varchar(100) NOT NULL,
  "payload" jsonb NOT NULL,
  "correlationId" varchar(64) NOT NULL,
  "actorId" uuid,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now(),
  "publishedAt" timestamptz(6)
);
CREATE INDEX "outbox_event_publishedAt_createdAt_idx" ON "outbox_event" ("publishedAt", "createdAt");
```

Run: `pnpm --filter qc prisma:generate`
Expected: `Generated Prisma Client … to ./node_modules/@prisma-clients/qc`.

- [ ] **Step 4: Write the integration-test helpers**

Create `apps/qc/prisma/test-db.ts`:

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/qc';

export async function startTestDb(): Promise<{ prisma: PrismaClient; stop(): Promise<void> }> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // fileURLToPath, not URL.pathname: the latter can stay percent-encoded on macOS.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return {
    prisma,
    async stop() { await prisma.$disconnect(); await container.stop(); },
  };
}
```

Create `apps/qc/prisma/fixtures.ts`:

```ts
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';

export const ACTOR = '0192f7a0-0000-7000-8000-00000000a001';

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.submission.deleteMany({});
  await prisma.outboxEvent.deleteMany({});
  await prisma.checklistTemplate.updateMany({ data: { currentVersionId: null } });
  await prisma.checklistTemplate.deleteMany({});
}

/** One template with one version holding one section and one item, written without the service. */
export async function seedPublishedTemplate(
  prisma: PrismaClient,
  opts: { code?: string; status?: 'PUBLISHED' | 'RETIRED'; retiredAt?: Date | null; disabled?: boolean } = {},
): Promise<{ templateId: string; versionId: string; itemId: string }> {
  const templateId = uuidv7();
  const versionId = uuidv7();
  const sectionId = uuidv7();
  const itemId = uuidv7();
  const status = opts.status ?? 'PUBLISHED';
  await prisma.checklistTemplate.create({
    data: {
      id: templateId, code: opts.code ?? 'AI-RRU', name: 'Antenna + RRU', category: 'QUALITY',
      createdBy: ACTOR, disabledAt: opts.disabled ? new Date() : null,
    },
  });
  await prisma.templateVersion.create({
    data: {
      id: versionId, templateId, version: 1, status, source: 'WEB', createdBy: ACTOR,
      publishedAt: new Date(), publishedBy: ACTOR, retiredAt: opts.retiredAt ?? null,
    },
  });
  await prisma.checklistSection.create({ data: { id: sectionId, versionId, number: '1', title: 'EHS', order: 0 } });
  await prisma.checklistItem.create({
    data: { id: itemId, sectionId, number: '1.1', requirementText: 'PPE worn', severity: 'NORMAL', responseType: 'RESULT_ONLY', order: 0 },
  });
  if (status === 'PUBLISHED') {
    await prisma.checklistTemplate.update({ where: { id: templateId }, data: { currentVersionId: versionId } });
  }
  return { templateId, versionId, itemId };
}
```

- [ ] **Step 5: Write the failing schema integration test**

Create `apps/qc/prisma/schema.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const version = (templateId: string, n: number, status: string) => prisma.templateVersion.create({
  data: { id: uuidv7(), templateId, version: n, status, source: 'WEB', createdBy: ACTOR },
});

describe('template_version partial unique indexes', () => {
  it('refuses a second draft for one template', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await version(templateId, 2, 'DRAFT');
    await expect(version(templateId, 3, 'DRAFT')).rejects.toThrow();
  });

  it('refuses a second published version for one template', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(version(templateId, 2, 'PUBLISHED')).rejects.toThrow();
  });

  it('allows any number of retired versions', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await version(templateId, 2, 'RETIRED');
    await expect(version(templateId, 3, 'RETIRED')).resolves.toBeTruthy();
  });

  it('refuses a duplicate code company-wide', async () => {
    await seedPublishedTemplate(prisma, { code: 'SAME' });
    await expect(seedPublishedTemplate(prisma, { code: 'SAME' })).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run it**

Run: `pnpm --filter qc exec vitest run prisma/schema.integration.spec.ts`
Expected: PASS (4 tests). The migration and indexes are what is under test here; if a test fails, the migration SQL is wrong.

- [ ] **Step 7: Write the failing unit test for version acceptance**

Create `apps/qc/src/submissions/version-acceptance.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { acceptVersion } from './version-acceptance.js';

const NOW = new Date('2026-09-22T12:00:00Z');
const DAY = 86_400_000;
const enabled = { disabledAt: null };

describe('acceptVersion', () => {
  it('accepts the published version', () => {
    expect(acceptVersion({ status: 'PUBLISHED', retiredAt: null }, enabled, NOW, 7)).toEqual({ ok: true });
  });

  it('accepts a version retired within the grace window', () => {
    const retiredAt = new Date(NOW.getTime() - 6 * DAY);
    expect(acceptVersion({ status: 'RETIRED', retiredAt }, enabled, NOW, 7)).toEqual({ ok: true });
  });

  it('refuses a version retired before the grace window', () => {
    const retiredAt = new Date(NOW.getTime() - 8 * DAY);
    expect(acceptVersion({ status: 'RETIRED', retiredAt }, enabled, NOW, 7)).toEqual({ ok: false, reason: 'SUPERSEDED' });
  });

  it('refuses at exactly the edge of the window', () => {
    const retiredAt = new Date(NOW.getTime() - 7 * DAY);
    expect(acceptVersion({ status: 'RETIRED', retiredAt }, enabled, NOW, 7)).toEqual({ ok: false, reason: 'SUPERSEDED' });
  });

  it('refuses a draft', () => {
    expect(acceptVersion({ status: 'DRAFT', retiredAt: null }, enabled, NOW, 7)).toEqual({ ok: false, reason: 'NOT_PUBLISHED' });
  });

  it('refuses anything on a disabled template, first', () => {
    expect(acceptVersion({ status: 'PUBLISHED', retiredAt: null }, { disabledAt: NOW }, NOW, 7)).toEqual({ ok: false, reason: 'DISABLED' });
  });
});
```

Run: `pnpm --filter qc exec vitest run src/submissions/version-acceptance.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement version acceptance**

Create `apps/qc/src/submissions/version-acceptance.ts`:

```ts
export type VersionAcceptance = { ok: true } | { ok: false; reason: 'DISABLED' | 'NOT_PUBLISHED' | 'SUPERSEDED' };

const DAY_MS = 86_400_000;

export function acceptVersion(
  version: { status: string; retiredAt: Date | null },
  template: { disabledAt: Date | null },
  now: Date,
  graceDays: number,
): VersionAcceptance {
  if (template.disabledAt) return { ok: false, reason: 'DISABLED' };
  if (version.status === 'PUBLISHED') return { ok: true };
  if (version.status === 'RETIRED') {
    const withinGrace = version.retiredAt !== null && version.retiredAt.getTime() > now.getTime() - graceDays * DAY_MS;
    return withinGrace ? { ok: true } : { ok: false, reason: 'SUPERSEDED' };
  }
  return { ok: false, reason: 'NOT_PUBLISHED' };
}
```

Run: `pnpm --filter qc exec vitest run src/submissions/version-acceptance.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Move the geofence client and split out the submission service**

```bash
mkdir -p apps/qc/src/submissions
git mv apps/qc/src/qc/site-geofence.client.ts apps/qc/src/submissions/site-geofence.client.ts
git mv apps/qc/src/qc/site-geofence.client.spec.ts apps/qc/src/submissions/site-geofence.client.spec.ts
git rm -q apps/qc/src/qc/qc.controller.ts apps/qc/src/qc/qc.service.ts
```

Create `apps/qc/src/submissions/submission.service.ts` (the old `QcService` submission methods, now resolving a version):

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7, type CreateSubmissionDto, type ReviewSubmissionDto } from '@ipms/contracts';
import { resolveGeofence, type SiteGeofenceClient } from './site-geofence.client.js';
import { acceptVersion } from './version-acceptance.js';

const REFUSAL = {
  DISABLED: () => new ConflictException('This checklist has been disabled'),
  NOT_PUBLISHED: () => new BadRequestException('This checklist version has not been published'),
  SUPERSEDED: () => new ConflictException('This checklist has been updated. Refresh to get the latest version.'),
} as const;

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly geofence: SiteGeofenceClient,
    private readonly graceDays: number,
  ) {}

  async getSubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id }, include: { responses: { include: { item: true, photos: true } }, decisions: true, template: true } });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  /**
   * `bearer` is the submitting user's own Authorization header, forwarded to
   * the project service so the geofence lookup stays permission-checked.
   */
  async createSubmission(dto: CreateSubmissionDto, actorId: string, bearer: string) {
    const duplicate = await this.prisma.submission.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (duplicate) return this.getSubmission(duplicate.id);
    const version = await this.prisma.templateVersion.findUnique({
      where: { id: dto.templateVersionId },
      include: { template: true, sections: { include: { items: true } } },
    });
    if (!version) throw new BadRequestException('Unknown checklist version');
    const acceptance = acceptVersion(version, version.template, new Date(), this.graceDays);
    if (!acceptance.ok) throw REFUSAL[acceptance.reason]();

    const items = version.sections.flatMap((section) => section.items);
    const responses = new Map(dto.responses.map((response) => [response.itemId, response]));
    if (responses.size !== dto.responses.length || items.some((item) => item.isRequired && !responses.has(item.id)) || [...responses.keys()].some((id) => !items.some((item) => item.id === id))) throw new BadRequestException('Responses must contain every required item from this template exactly once');
    for (const item of items) {
      const response = responses.get(item.id);
      if (!response) continue;
      if (response.selfCheckResult === 'NA' && !item.allowsNa) throw new BadRequestException(`Item ${item.number} does not allow N/A`);
      if (response.photoMediaIds.length < item.minPhotos || response.photoMediaIds.length > item.maxPhotos) throw new BadRequestException(`Item ${item.number} has an invalid photo count`);
    }
    const last = await this.prisma.submission.aggregate({ where: { taskId: dto.taskId }, _max: { attemptNo: true } });
    const integrityHash = createHash('sha256').update(JSON.stringify(dto.responses.map((r) => ({ itemId: r.itemId, result: r.selfCheckResult, photos: [...r.photoMediaIds].sort() })).sort((a, b) => a.itemId.localeCompare(b.itemId)))).digest('hex');
    // Never throws: an unreachable project service records UNVERIFIED rather
    // than failing a submission that represents work already done in the field.
    const outcome = resolveGeofence(await this.geofence.fetch(dto.siteId, bearer), dto);
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({ data: { id: uuidv7(), taskId: dto.taskId, siteId: dto.siteId, projectId: dto.projectId, templateId: version.templateId, templateVersionId: version.id, templateVersion: version.version, attemptNo: (last._max.attemptNo ?? 0) + 1, status: 'SUBMITTED', submittedBy: actorId, submittedAt: new Date(), integrityHash, idempotencyKey: dto.idempotencyKey, deviceId: dto.deviceId ?? null, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, distanceFromSiteM: outcome.distanceFromSiteM, geofenceStatus: outcome.geofenceStatus } });
      for (const response of dto.responses) {
        const itemResponse = await tx.itemResponse.create({ data: { id: uuidv7(), submissionId: submission.id, itemId: response.itemId, selfCheckResult: response.selfCheckResult, selfCheckDescription: response.selfCheckDescription ?? null, textValue: response.textValue ?? null, numberValue: response.numberValue ?? null, booleanValue: response.booleanValue ?? null, selectValue: response.selectValue ?? null } });
        if (response.photoMediaIds.length) await tx.itemPhoto.createMany({ data: response.photoMediaIds.map((mediaId, sequence) => ({ id: uuidv7(), itemResponseId: itemResponse.id, mediaId, sequence })) });
      }
      return submission;
    });
  }

  async reviewSubmission(id: string, dto: ReviewSubmissionDto, actorId: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id }, include: { responses: { include: { item: true } } } });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== 'SUBMITTED' && submission.status !== 'UNDER_REVIEW') throw new ConflictException('Only submitted work can be reviewed');
    const reviews = new Map(dto.itemReviews.map((review) => [review.itemId, review]));
    if (reviews.size !== submission.responses.length || submission.responses.some((response) => !reviews.has(response.itemId))) throw new BadRequestException('Every submitted item needs a review result');
    const rejected = [...reviews.values()].some((review) => review.result === 'REJECTED');
    if (dto.decision === 'APPROVE' && rejected) throw new BadRequestException('A submission with rejected items cannot be approved');
    return this.prisma.$transaction(async (tx) => {
      for (const response of submission.responses) { const review = reviews.get(response.itemId)!; await tx.itemResponse.update({ where: { id: response.id }, data: { reviewResult: review.result, reviewDescription: review.description ?? null, reviewedBy: actorId, reviewedAt: new Date() } }); }
      const approved = dto.decision === 'APPROVE';
      await tx.reviewDecision.create({ data: { id: uuidv7(), submissionId: id, reviewerId: actorId, decision: dto.decision, comment: dto.comment ?? null } });
      return tx.submission.update({ where: { id }, data: { status: approved ? 'APPROVED' : 'REJECTED_REWORK', overallVerdict: approved ? 'PASS' : 'FAIL', reviewedBy: actorId, reviewedAt: new Date(), reviewComment: dto.comment ?? null } });
    });
  }
}
```

Create `apps/qc/src/submissions/submission.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { CreateSubmissionSchema, ReviewSubmissionSchema, UuidSchema } from '@ipms/contracts';
import { SubmissionService } from './submission.service.js';

@Controller('qc/submissions')
export class SubmissionController {
  constructor(private readonly service: SubmissionService) {}

  @Get(':id') @RequirePermission('qc_submission.view')
  get(@Param('id') id: string) { return this.service.getSubmission(UuidSchema.parse(id)); }

  @Post() @RequirePermission('qc_submission.create')
  submit(@Body() body: unknown, @Req() req: { user: AuthzUser; headers: Record<string, string | undefined> }) {
    return this.service.createSubmission(CreateSubmissionSchema.parse(body), req.user.id, req.headers['authorization'] ?? '');
  }

  @Post(':id/review') @RequirePermission('qc_review.approve')
  review(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.reviewSubmission(UuidSchema.parse(id), ReviewSubmissionSchema.parse(body), req.user.id);
  }
}
```

Replace `apps/qc/src/app.module.ts` (readable form; template providers are added in Task 6):

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';
import { SiteGeofenceClient } from './submissions/site-geofence.client.js';
import { SubmissionController } from './submissions/submission.controller.js';
import { SubmissionService } from './submissions/submission.service.js';

// Least-permissive scope: no qc route passes a resource to check(), so scope is never consulted.
const scopeProvider: ScopeProvider = { async for(): Promise<AuthzScope> { return { global: false, projectIds: [], siteIds: [] }; } };

const projectInternalUrl = (): string => process.env['PROJECT_INTERNAL_URL'] ?? 'http://project:3004';
const graceDays = (): number => Number(process.env['QC_RETIRED_VERSION_GRACE_DAYS'] ?? 7);

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [SubmissionController, HealthController, MetricsController],
  providers: [
    // Order matters: JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: scopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: () => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    { provide: SiteGeofenceClient, useFactory: () => new SiteGeofenceClient(projectInternalUrl()) },
    {
      provide: SubmissionService,
      useFactory: (prisma: PrismaService, geofence: SiteGeofenceClient) => new SubmissionService(prisma.db, geofence, graceDays()),
      inject: [PrismaService, SiteGeofenceClient],
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 10: Write the submission integration test**

Create `apps/qc/prisma/submission.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { SubmissionService } from '../src/submissions/submission.service.js';
import type { SiteGeofenceClient } from '../src/submissions/site-geofence.client.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: SubmissionService;
const noGeofence = { fetch: async () => null } as unknown as SiteGeofenceClient;
const DAY = 86_400_000;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  service = new SubmissionService(prisma, noGeofence, 7);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const submit = (templateVersionId: string, itemId: string) => service.createSubmission({
  taskId: uuidv7(), siteId: uuidv7(), projectId: uuidv7(), templateVersionId,
  idempotencyKey: `key-${uuidv7()}`,
  responses: [{ itemId, selfCheckResult: 'PASS', photoMediaIds: [] }],
}, ACTOR, 'Bearer t');

describe('createSubmission against template versions', () => {
  it('accepts the published version and records its number', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    const submission = await submit(versionId, itemId);
    expect(submission).toMatchObject({ templateId, templateVersionId: versionId, templateVersion: 1, geofenceStatus: 'UNVERIFIED' });
  });

  it('accepts a version retired within the grace window', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { status: 'RETIRED', retiredAt: new Date(Date.now() - 2 * DAY) });
    await expect(submit(versionId, itemId)).resolves.toBeTruthy();
  });

  it('refuses a version retired before the grace window', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { status: 'RETIRED', retiredAt: new Date(Date.now() - 9 * DAY) });
    await expect(submit(versionId, itemId)).rejects.toThrow('This checklist has been updated');
  });

  it('refuses a disabled template', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { disabled: true });
    await expect(submit(versionId, itemId)).rejects.toThrow('This checklist has been disabled');
  });
});
```

- [ ] **Step 11: Run all qc tests and the typecheck**

Run: `pnpm --filter qc exec vitest run && pnpm --filter qc typecheck`
Expected: PASS (schema, submission, version-acceptance, geofence specs); typecheck clean.

- [ ] **Step 12: Commit**

```bash
git add apps/qc pnpm-lock.yaml
git commit -m "feat(qc): rebuild templates as a versioned company-wide library

Submissions now reference a template version and are accepted against a
version retired within the grace window.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Draft lifecycle — create, rename, new version, save, discard

**Files:**
- Create: `apps/qc/src/templates/document.ts`
- Create: `apps/qc/src/templates/audit.ts`
- Create: `apps/qc/src/templates/template.service.ts`
- Create: `apps/qc/prisma/template-drafts.integration.spec.ts`

**Interfaces:**
- Consumes: `TemplateDocument`, `CreateTemplateDto`, `UpdateTemplateDto`, `SaveDraftDto`, `TemplateMetadata` (Task 1); `startTestDb`, `resetDb`, `ACTOR` (Task 2).
- Produces:
  - `document.ts`: `type Tx = Prisma.TransactionClient`; `TREE_INCLUDE` (Prisma include for sections → items, ordered); `type VersionWithTree`; `toDocument(version: VersionWithTree): TemplateDocument`; `writeTree(tx: Tx, versionId: string, doc: TemplateDocument): Promise<void>`; `clearTree(tx: Tx, versionId: string): Promise<void>`; `isUniqueViolation(error: unknown): boolean`.
  - `audit.ts`: `recordAudit(tx: Tx, entry: { actorId: string; action: string; objectId: string; previousState: JsonObject; newState: JsonObject }): Promise<void>`.
  - `template.service.ts`: `DraftSummary = { id: string; version: number; revision: number; source: string; updatedAt: Date }`, `CreatedDraft = { templateId: string; draft: DraftSummary }`, and `class TemplateService` with `create(dto, actorId): Promise<CreatedDraft>`, `createFromImport(meta, doc, actorId): Promise<CreatedDraft>`, `rename(id, dto, actorId)`, `startDraft(id, actorId): Promise<CreatedDraft>`, `saveDraft(id, dto, actorId): Promise<DraftSummary>`, `importIntoDraft(id, doc, expectedRevision: number | undefined, actorId): Promise<CreatedDraft>`, `discardDraft(id, actorId): Promise<{ templateDeleted: boolean }>`. Task 4 adds `publish`, `disable`, `enable` to the same class.

- [ ] **Step 1: Write the failing integration test**

Create `apps/qc/prisma/template-drafts.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateDocumentSchema, type TemplateDocument } from '@ipms/contracts';
import { TemplateService } from '../src/templates/template.service.js';
import { TREE_INCLUDE, toDocument } from '../src/templates/document.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: TemplateService;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new TemplateService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const META = { code: 'AI-RRU', name: 'Antenna + RRU', category: 'QUALITY' as const };
const DOC: TemplateDocument = TemplateDocumentSchema.parse({
  sections: [
    { number: '1', title: 'EHS', items: [
      { number: '1.1', requirementText: 'PPE worn', severity: 'CRITICAL', minPhotos: 1, maxPhotos: 3, guidanceText: 'Helmet visible' },
      { number: '1.2', requirementText: 'Mount type', responseType: 'SELECT', selectOptions: ['Pole', 'Wall'] },
    ] },
    { number: '2', title: 'Antenna', items: [{ number: '2.1', requirementText: 'Azimuth', responseType: 'NUMBER', allowsNa: true }] },
  ],
});

async function draftDocument(templateId: string): Promise<TemplateDocument> {
  const draft = await prisma.templateVersion.findFirstOrThrow({ where: { templateId, status: 'DRAFT' }, include: TREE_INCLUDE });
  return toDocument(draft);
}

const auditActions = async () => (await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } }))
  .map((row) => (row.payload as { action: string }).action);

describe('create', () => {
  it('makes a template with an empty v1 draft and audits it', async () => {
    const created = await service.create(META, ACTOR);
    expect(created.draft).toMatchObject({ version: 1, revision: 1, source: 'WEB' });
    expect(await draftDocument(created.templateId)).toEqual({ sections: [] });
    expect(await auditActions()).toEqual(['qc_template.created']);
  });

  it('refuses a code that exists', async () => {
    await service.create(META, ACTOR);
    await expect(service.create(META, ACTOR)).rejects.toThrow('A template with code AI-RRU already exists');
  });
});

describe('saveDraft', () => {
  it('replaces the whole tree and bumps the revision', async () => {
    const { templateId } = await service.create(META, ACTOR);
    const saved = await service.saveDraft(templateId, { revision: 1, document: DOC }, ACTOR);
    expect(saved.revision).toBe(2);
    expect(await draftDocument(templateId)).toEqual(DOC);
  });

  it('refuses a stale revision and leaves the draft untouched', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await service.saveDraft(templateId, { revision: 1, document: DOC }, ACTOR);
    await expect(service.saveDraft(templateId, { revision: 1, document: { sections: [] } }, ACTOR))
      .rejects.toThrow('Someone else saved this draft');
    expect(await draftDocument(templateId)).toEqual(DOC);
  });

  it('lets exactly one of two concurrent saves at the same revision win', async () => {
    const { templateId } = await service.create(META, ACTOR);
    const results = await Promise.allSettled([
      service.saveDraft(templateId, { revision: 1, document: DOC }, ACTOR),
      service.saveDraft(templateId, { revision: 1, document: { sections: [] } }, ACTOR),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('answers 409 when there is no draft', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(service.saveDraft(templateId, { revision: 1, document: DOC }, ACTOR)).rejects.toThrow('This template has no draft');
  });
});

describe('startDraft', () => {
  it('clones the published version as the next version', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const created = await service.startDraft(templateId, ACTOR);
    expect(created.draft).toMatchObject({ version: 2, revision: 1 });
    expect((await draftDocument(templateId)).sections[0]!.items[0]!.requirementText).toBe('PPE worn');
  });

  it('refuses when a draft already exists', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    await expect(service.startDraft(templateId, ACTOR)).rejects.toThrow('A draft (v2) already exists');
  });

  it('refuses when nothing is published', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.startDraft(templateId, ACTOR)).rejects.toThrow('A draft (v1) already exists');
  });
});

describe('discardDraft', () => {
  it('deletes a never-published template together with its draft', async () => {
    const { templateId } = await service.create(META, ACTOR);
    expect(await service.discardDraft(templateId, ACTOR)).toEqual({ templateDeleted: true });
    expect(await prisma.checklistTemplate.count()).toBe(0);
  });

  it('keeps a published template and its current version', async () => {
    const { templateId, versionId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    expect(await service.discardDraft(templateId, ACTOR)).toEqual({ templateDeleted: false });
    const template = await prisma.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.currentVersionId).toBe(versionId);
    expect(await auditActions()).toEqual(['qc_template.draft_discarded']);
  });
});

describe('rename', () => {
  it('updates name and category and audits only what changed', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await service.rename(templateId, { name: 'Antenna only' }, ACTOR);
    const events = await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events[1]!.payload).toMatchObject({
      action: 'qc_template.updated', previousState: { name: 'Antenna + RRU' }, newState: { name: 'Antenna only' },
    });
  });
});

describe('importIntoDraft', () => {
  it('creates the next draft from an imported document', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const created = await service.importIntoDraft(templateId, DOC, undefined, ACTOR);
    expect(created.draft).toMatchObject({ version: 2, source: 'EXCEL_IMPORT' });
    expect(await draftDocument(templateId)).toEqual(DOC);
    expect(await auditActions()).toEqual(['qc_template.imported']);
  });

  it('replaces an existing draft only at the previewed revision', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.importIntoDraft(templateId, DOC, undefined, ACTOR)).rejects.toThrow('Preview the file again');
    const created = await service.importIntoDraft(templateId, DOC, 1, ACTOR);
    expect(created.draft).toMatchObject({ version: 1, revision: 2, source: 'EXCEL_IMPORT' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter qc exec vitest run prisma/template-drafts.integration.spec.ts`
Expected: FAIL — `Cannot find module '../src/templates/template.service.js'`.

- [ ] **Step 3: Write the document helpers**

Create `apps/qc/src/templates/document.ts`:

```ts
import { Prisma } from '@prisma-clients/qc';
import { uuidv7, type TemplateDocument } from '@ipms/contracts';

// A full PrismaClient is assignable to this too, so helpers work inside and outside a transaction.
export type Tx = Prisma.TransactionClient;

export const TREE_INCLUDE = {
  sections: { orderBy: { order: 'asc' }, include: { items: { orderBy: { order: 'asc' } } } },
} as const satisfies Prisma.TemplateVersionInclude;

export type VersionWithTree = Prisma.TemplateVersionGetPayload<{ include: typeof TREE_INCLUDE }>;

export function toDocument(version: VersionWithTree): TemplateDocument {
  return {
    sections: version.sections.map((section) => ({
      number: section.number,
      title: section.title,
      items: section.items.map((item) => ({
        number: item.number,
        requirementText: item.requirementText,
        severity: item.severity as 'NORMAL' | 'CRITICAL',
        responseType: item.responseType as TemplateDocument['sections'][number]['items'][number]['responseType'],
        selectOptions: item.selectOptions,
        minPhotos: item.minPhotos,
        maxPhotos: item.maxPhotos,
        allowsNa: item.allowsNa,
        isRequired: item.isRequired,
        ...(item.guidanceText === null ? {} : { guidanceText: item.guidanceText }),
      })),
    })),
  };
}

export async function clearTree(tx: Tx, versionId: string): Promise<void> {
  await tx.checklistSection.deleteMany({ where: { versionId } });
}

export async function writeTree(tx: Tx, versionId: string, doc: TemplateDocument): Promise<void> {
  for (const [sectionOrder, section] of doc.sections.entries()) {
    const sectionId = uuidv7();
    await tx.checklistSection.create({ data: { id: sectionId, versionId, number: section.number, title: section.title, order: sectionOrder } });
    if (section.items.length === 0) continue;
    await tx.checklistItem.createMany({
      data: section.items.map((item, itemOrder) => ({
        id: uuidv7(), sectionId, number: item.number, requirementText: item.requirementText,
        severity: item.severity, responseType: item.responseType, selectOptions: item.selectOptions,
        minPhotos: item.minPhotos, maxPhotos: item.maxPhotos, allowsNa: item.allowsNa,
        isRequired: item.isRequired, guidanceText: item.guidanceText ?? null, order: itemOrder,
      })),
    });
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
```

Create `apps/qc/src/templates/audit.ts`:

```ts
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import type { Tx } from './document.js';

/** Written inside the action's own transaction, so an action and its audit entry commit together. */
export async function recordAudit(
  tx: Tx,
  entry: { actorId: string; action: string; objectId: string; previousState: JsonObject; newState: JsonObject },
): Promise<void> {
  await tx.outboxEvent.create({
    data: buildOutboxRecord(SUBJECTS.AUDIT_EVENT, {
      actorId: entry.actorId, action: entry.action, objectType: 'ChecklistTemplate', objectId: entry.objectId,
      previousState: entry.previousState, newState: entry.newState, details: {},
    }, getCorrelationId() ?? 'unknown', entry.actorId),
  });
}
```

- [ ] **Step 4: Write the service**

Create `apps/qc/src/templates/template.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, TemplateVersion } from '@prisma-clients/qc';
import {
  uuidv7, type CreateTemplateDto, type SaveDraftDto, type TemplateDocument,
  type TemplateMetadata, type UpdateTemplateDto,
} from '@ipms/contracts';
import type { JsonObject } from '@ipms/persistence';
import { recordAudit } from './audit.js';
import { TREE_INCLUDE, clearTree, isUniqueViolation, toDocument, writeTree, type Tx } from './document.js';

export interface DraftSummary { id: string; version: number; revision: number; source: string; updatedAt: Date }
export interface CreatedDraft { templateId: string; draft: DraftSummary }

const STALE_SAVE = 'Someone else saved this draft. Reload to see their changes.';
const STALE_IMPORT = "This template's draft changed since the preview. Preview the file again.";

const summary = (version: TemplateVersion): DraftSummary => ({
  id: version.id, version: version.version, revision: version.revision, source: version.source, updatedAt: version.updatedAt,
});

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(dto: CreateTemplateDto, actorId: string): Promise<CreatedDraft> {
    return this.createTemplate(dto, { sections: [] }, 'WEB', actorId);
  }

  async createFromImport(meta: TemplateMetadata, doc: TemplateDocument, actorId: string): Promise<CreatedDraft> {
    return this.createTemplate(meta, doc, 'EXCEL_IMPORT', actorId);
  }

  async rename(id: string, dto: UpdateTemplateDto, actorId: string) {
    const template = await this.requireTemplate(this.prisma, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.checklistTemplate.update({
        where: { id },
        data: { ...(dto.name === undefined ? {} : { name: dto.name }), ...(dto.category === undefined ? {} : { category: dto.category }) },
      });
      const previousState: JsonObject = {};
      const newState: JsonObject = {};
      if (dto.name !== undefined) { previousState['name'] = template.name; newState['name'] = updated.name; }
      if (dto.category !== undefined) { previousState['category'] = template.category; newState['category'] = updated.category; }
      await recordAudit(tx, { actorId, action: 'qc_template.updated', objectId: id, previousState, newState });
      return updated;
    });
  }

  async startDraft(id: string, actorId: string): Promise<CreatedDraft> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireTemplate(tx, id);
      const existing = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' } });
      if (existing) throw new ConflictException(`A draft (v${existing.version}) already exists`);
      const current = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'PUBLISHED' }, include: TREE_INCLUDE });
      if (!current) throw new ConflictException('This template has nothing published to copy');
      const draft = await this.createDraftVersion(tx, id, 'WEB', actorId);
      await writeTree(tx, draft.id, toDocument(current));
      return { templateId: id, draft: summary(draft) };
    });
  }

  async saveDraft(id: string, dto: SaveDraftDto, _actorId: string): Promise<DraftSummary> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const draft = await this.requireDraft(tx, id);
        const saved = await this.replaceDraftTree(tx, draft.id, dto.revision, dto.document, {}, STALE_SAVE);
        return summary(saved);
      });
    } catch (error) {
      // Two saves that both passed the revision check collide on the tree's unique numbers.
      if (isUniqueViolation(error)) throw new ConflictException(STALE_SAVE);
      throw error;
    }
  }

  async importIntoDraft(id: string, doc: TemplateDocument, expectedRevision: number | undefined, actorId: string): Promise<CreatedDraft> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireTemplate(tx, id);
      const existing = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' } });
      let draft: TemplateVersion;
      if (existing) {
        if (expectedRevision !== existing.revision) throw new ConflictException(STALE_IMPORT);
        draft = await this.replaceDraftTree(tx, existing.id, existing.revision, doc, { source: 'EXCEL_IMPORT' }, STALE_IMPORT);
      } else {
        draft = await this.createDraftVersion(tx, id, 'EXCEL_IMPORT', actorId);
        await writeTree(tx, draft.id, doc);
      }
      await recordAudit(tx, {
        actorId, action: 'qc_template.imported', objectId: id,
        previousState: existing ? { draftVersion: existing.version } : {},
        newState: { draftVersion: draft.version, source: 'EXCEL_IMPORT' },
      });
      return { templateId: id, draft: summary(draft) };
    });
  }

  async discardDraft(id: string, actorId: string): Promise<{ templateDeleted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const template = await this.requireTemplate(tx, id);
      const draft = await this.requireDraft(tx, id);
      const templateDeleted = template.currentVersionId === null;
      await recordAudit(tx, { actorId, action: 'qc_template.draft_discarded', objectId: id, previousState: { version: draft.version }, newState: {} });
      if (templateDeleted) await tx.checklistTemplate.delete({ where: { id } });
      else await tx.templateVersion.delete({ where: { id: draft.id } });
      return { templateDeleted };
    });
  }

  private async createTemplate(meta: TemplateMetadata, doc: TemplateDocument, source: 'WEB' | 'EXCEL_IMPORT', actorId: string): Promise<CreatedDraft> {
    const duplicate = () => new ConflictException(`A template with code ${meta.code} already exists`);
    if (await this.prisma.checklistTemplate.findUnique({ where: { code: meta.code } })) throw duplicate();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const template = await tx.checklistTemplate.create({
          data: { id: uuidv7(), code: meta.code, name: meta.name, category: meta.category, createdBy: actorId },
        });
        const draft = await this.createDraftVersion(tx, template.id, source, actorId);
        await writeTree(tx, draft.id, doc);
        await recordAudit(tx, source === 'WEB'
          ? { actorId, action: 'qc_template.created', objectId: template.id, previousState: {}, newState: { code: meta.code, name: meta.name, category: meta.category } }
          : { actorId, action: 'qc_template.imported', objectId: template.id, previousState: {}, newState: { draftVersion: draft.version, source } });
        return { templateId: template.id, draft: summary(draft) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate();
      throw error;
    }
  }

  private async createDraftVersion(tx: Tx, templateId: string, source: 'WEB' | 'EXCEL_IMPORT', actorId: string): Promise<TemplateVersion> {
    const latest = await tx.templateVersion.aggregate({ where: { templateId }, _max: { version: true } });
    return tx.templateVersion.create({
      data: { id: uuidv7(), templateId, version: (latest._max.version ?? 0) + 1, status: 'DRAFT', revision: 1, source, createdBy: actorId },
    });
  }

  /**
   * The conditional update takes the row lock, so a concurrent save at the same
   * revision waits, re-reads the row, and matches nothing.
   */
  private async replaceDraftTree(
    tx: Tx, versionId: string, revision: number, doc: TemplateDocument,
    data: { source?: 'EXCEL_IMPORT' }, staleMessage: string,
  ): Promise<TemplateVersion> {
    const bumped = await tx.templateVersion.updateMany({
      where: { id: versionId, status: 'DRAFT', revision },
      data: { revision: { increment: 1 }, ...data },
    });
    if (bumped.count === 0) throw new ConflictException(staleMessage);
    await clearTree(tx, versionId);
    await writeTree(tx, versionId, doc);
    return tx.templateVersion.findUniqueOrThrow({ where: { id: versionId } });
  }

  private async requireTemplate(tx: Tx, id: string) {
    const template = await tx.checklistTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Checklist template not found');
    return template;
  }

  private async requireDraft(tx: Tx, id: string): Promise<TemplateVersion> {
    const draft = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' } });
    if (draft) return draft;
    await this.requireTemplate(tx, id);
    throw new ConflictException('This template has no draft');
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter qc exec vitest run prisma/template-drafts.integration.spec.ts && pnpm --filter qc typecheck`
Expected: PASS (14 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/qc/src/templates apps/qc/prisma/template-drafts.integration.spec.ts
git commit -m "feat(qc): add the draft lifecycle for checklist templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Publish, disable, enable

**Files:**
- Modify: `apps/qc/src/templates/template.service.ts`
- Create: `apps/qc/prisma/template-publish.integration.spec.ts`

**Interfaces:**
- Consumes: `TemplateService` internals from Task 3 (`requireTemplate`, `TREE_INCLUDE`, `toDocument`, `recordAudit`); `PublishableDocumentSchema` (Task 1).
- Produces: `TemplateService.publish(id, actorId): Promise<TemplateVersion>`, `disable(id, actorId): Promise<ChecklistTemplate>`, `enable(id, actorId): Promise<ChecklistTemplate>`.

- [ ] **Step 1: Write the failing integration test**

Create `apps/qc/prisma/template-publish.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateService } from '../src/templates/template.service.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: TemplateService;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new TemplateService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const META = { code: 'AI-RRU', name: 'Antenna + RRU', category: 'QUALITY' as const };
const DOC = { sections: [{ number: '1', title: 'EHS', items: [{ number: '1.1', requirementText: 'PPE worn', severity: 'NORMAL' as const, responseType: 'RESULT_ONLY' as const, selectOptions: [], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true }] }] };

describe('publish', () => {
  it('publishes a first version and points the template at it', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await service.saveDraft(templateId, { revision: 1, document: DOC }, ACTOR);
    const published = await service.publish(templateId, ACTOR);
    expect(published).toMatchObject({ version: 1, status: 'PUBLISHED', publishedBy: ACTOR });
    const template = await prisma.checklistTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.currentVersionId).toBe(published.id);
  });

  it('retires the previous version', async () => {
    const { templateId, versionId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    const published = await service.publish(templateId, ACTOR);
    const previous = await prisma.templateVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(previous.status).toBe('RETIRED');
    expect(previous.retiredAt).toBeInstanceOf(Date);
    expect(published.version).toBe(2);
    const events = await prisma.outboxEvent.findMany();
    expect(events.map((e) => e.payload)).toContainEqual(expect.objectContaining({
      action: 'qc_template.published', previousState: { version: 1 }, newState: { version: 2 },
    }));
  });

  it('refuses an incomplete draft with a validation error', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.publish(templateId, ACTOR)).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses when there is no draft', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(service.publish(templateId, ACTOR)).rejects.toThrow('This template has no draft');
  });

  it('refuses while disabled', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    await service.disable(templateId, ACTOR);
    await expect(service.publish(templateId, ACTOR)).rejects.toThrow('Enable this template before publishing');
  });

  it('leaves exactly one published version when two publishes race', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    await Promise.allSettled([service.publish(templateId, ACTOR), service.publish(templateId, ACTOR)]);
    expect(await prisma.templateVersion.count({ where: { templateId, status: 'PUBLISHED' } })).toBe(1);
    expect(await prisma.templateVersion.count({ where: { templateId, status: 'RETIRED' } })).toBe(1);
  });
});

describe('disable and enable', () => {
  it('disables and re-enables a published template', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    expect((await service.disable(templateId, ACTOR)).disabledAt).toBeInstanceOf(Date);
    expect((await service.enable(templateId, ACTOR)).disabledAt).toBeNull();
    const actions = (await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => (e.payload as { action: string }).action);
    expect(actions).toEqual(['qc_template.disabled', 'qc_template.enabled']);
  });

  it('refuses to disable a template never published', async () => {
    const { templateId } = await service.create(META, ACTOR);
    await expect(service.disable(templateId, ACTOR)).rejects.toThrow('Only a published template can be disabled');
  });

  it('refuses to enable a template that is not disabled', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(service.enable(templateId, ACTOR)).rejects.toThrow('This template is not disabled');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter qc exec vitest run prisma/template-publish.integration.spec.ts`
Expected: FAIL — `service.publish is not a function`.

- [ ] **Step 3: Implement**

In `apps/qc/src/templates/template.service.ts`, add `PublishableDocumentSchema` to the `@ipms/contracts` import, and add these methods to `TemplateService` (after `discardDraft`):

```ts
  async publish(id: string, actorId: string): Promise<TemplateVersion> {
    return this.prisma.$transaction(async (tx) => {
      // Serializes publishes of one template; the partial unique index is the backstop.
      await tx.$queryRaw`SELECT "id" FROM "checklist_template" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const template = await this.requireTemplate(tx, id);
      if (template.disabledAt) throw new ConflictException('Enable this template before publishing');
      const draft = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' }, include: TREE_INCLUDE });
      if (!draft) throw new ConflictException('This template has no draft');
      const checked = PublishableDocumentSchema.safeParse(toDocument(draft));
      // Thrown as-is so the exception filter renders field paths as a 422.
      if (!checked.success) throw checked.error;
      const now = new Date();
      const previous = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'PUBLISHED' } });
      if (previous) await tx.templateVersion.update({ where: { id: previous.id }, data: { status: 'RETIRED', retiredAt: now } });
      const published = await tx.templateVersion.update({
        where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: now, publishedBy: actorId },
      });
      await tx.checklistTemplate.update({ where: { id }, data: { currentVersionId: published.id } });
      await recordAudit(tx, {
        actorId, action: 'qc_template.published', objectId: id,
        previousState: { version: previous?.version ?? null }, newState: { version: published.version },
      });
      return published;
    });
  }

  async disable(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const template = await this.requireTemplate(tx, id);
      if (template.disabledAt) throw new ConflictException('This template is already disabled');
      if (!template.currentVersionId) throw new ConflictException('Only a published template can be disabled');
      const updated = await tx.checklistTemplate.update({ where: { id }, data: { disabledAt: new Date() } });
      await recordAudit(tx, { actorId, action: 'qc_template.disabled', objectId: id, previousState: { disabledAt: null }, newState: { disabledAt: updated.disabledAt!.toISOString() } });
      return updated;
    });
  }

  async enable(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const template = await this.requireTemplate(tx, id);
      if (!template.disabledAt) throw new ConflictException('This template is not disabled');
      const updated = await tx.checklistTemplate.update({ where: { id }, data: { disabledAt: null } });
      await recordAudit(tx, { actorId, action: 'qc_template.enabled', objectId: id, previousState: { disabledAt: template.disabledAt.toISOString() }, newState: { disabledAt: null } });
      return updated;
    });
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter qc exec vitest run prisma/template-publish.integration.spec.ts prisma/template-drafts.integration.spec.ts && pnpm --filter qc typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/qc/src/templates/template.service.ts apps/qc/prisma/template-publish.integration.spec.ts
git commit -m "feat(qc): publish, disable and enable checklist templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Template reads

**Files:**
- Create: `apps/qc/src/templates/template.queries.ts`
- Create: `apps/qc/prisma/template-queries.integration.spec.ts`

**Interfaces:**
- Consumes: `TREE_INCLUDE`, `VersionWithTree` (Task 3); `ListTemplatesQueryDto` (Task 1).
- Produces: `class TemplateQueries` with
  - `list(query: ListTemplatesQueryDto): Promise<TemplateListEntry[]>` where `TemplateListEntry = { id; code; name; category; disabledAt: Date | null; current: { version; publishedAt; publishedBy; sectionCount; itemCount; criticalCount } | null; draft: { version; revision; updatedAt; source } | null }`
  - `get(id): Promise<ChecklistTemplate & { versions: VersionRow[] }>`
  - `getVersion(id, version): Promise<{ template: ChecklistTemplate; version: VersionWithTree }>`
  - `currentTree(templateId): Promise<{ template: ChecklistTemplate; version: VersionWithTree | null } | null>`

- [ ] **Step 1: Write the failing integration test**

Create `apps/qc/prisma/template-queries.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateQueries } from '../src/templates/template.queries.js';
import { TemplateService } from '../src/templates/template.service.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let queries: TemplateQueries;
let service: TemplateService;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  queries = new TemplateQueries(prisma);
  service = new TemplateService(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

describe('list', () => {
  it('sorts each tab by code and counts the current version in SQL', async () => {
    const enabled = await seedPublishedTemplate(prisma, { code: 'B-ENABLED' });
    await seedPublishedTemplate(prisma, { code: 'A-ENABLED' });
    const drafted = await service.create({ code: 'C-DRAFT', name: 'Draft only', category: 'EHS' }, ACTOR);
    const disabled = await seedPublishedTemplate(prisma, { code: 'D-DISABLED' });
    await service.disable(disabled.templateId, ACTOR);
    await service.startDraft(enabled.templateId, ACTOR);

    const enabledTab = await queries.list({ tab: 'enabled' });
    expect(enabledTab.map((t) => t.code)).toEqual(['A-ENABLED', 'B-ENABLED']);
    expect(enabledTab[1]).toMatchObject({
      current: { version: 1, sectionCount: 1, itemCount: 1, criticalCount: 0 },
      draft: { version: 2, revision: 1, source: 'WEB' },
    });

    expect((await queries.list({ tab: 'draft' })).map((t) => t.code)).toEqual(['B-ENABLED', 'C-DRAFT']);
    expect((await queries.list({ tab: 'draft' })).find((t) => t.id === drafted.templateId)?.current).toBeNull();
    expect((await queries.list({ tab: 'disabled' })).map((t) => t.code)).toEqual(['D-DISABLED']);
  });

  it('filters by category and a case-insensitive search on code or name', async () => {
    await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    await service.create({ code: 'EHS-1', name: 'Tower climb', category: 'EHS' }, ACTOR);
    expect((await queries.list({ tab: 'draft', category: 'EHS' })).map((t) => t.code)).toEqual(['EHS-1']);
    expect((await queries.list({ tab: 'enabled', q: 'antenna' })).map((t) => t.code)).toEqual(['AI-RRU']);
    expect((await queries.list({ tab: 'enabled', q: 'ai-r' })).map((t) => t.code)).toEqual(['AI-RRU']);
  });
});

describe('get and getVersion', () => {
  it('returns versions newest first', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await service.startDraft(templateId, ACTOR);
    const detail = await queries.get(templateId);
    expect(detail.versions.map((v) => [v.version, v.status])).toEqual([[2, 'DRAFT'], [1, 'PUBLISHED']]);
  });

  it('returns a version with its ordered tree', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const { template, version } = await queries.getVersion(templateId, 1);
    expect(template.code).toBe('AI-RRU');
    expect(version.sections[0]!.items[0]!.number).toBe('1.1');
  });

  it('answers 404 for an unknown version', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    await expect(queries.getVersion(templateId, 9)).rejects.toThrow('Template version not found');
  });
});

describe('currentTree', () => {
  it('returns the published version, or null for the version when nothing is published', async () => {
    const published = await seedPublishedTemplate(prisma);
    expect((await queries.currentTree(published.templateId))?.version?.id).toBe(published.versionId);
    const drafted = await service.create({ code: 'NEW', name: 'New', category: 'OTHER' }, ACTOR);
    expect((await queries.currentTree(drafted.templateId))?.version).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter qc exec vitest run prisma/template-queries.integration.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/qc/src/templates/template.queries.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma-clients/qc';
import type { ListTemplatesQueryDto } from '@ipms/contracts';
import { TREE_INCLUDE } from './document.js';

export interface TemplateListEntry {
  id: string; code: string; name: string; category: string; disabledAt: Date | null;
  current: { version: number; publishedAt: Date | null; publishedBy: string | null; sectionCount: number; itemCount: number; criticalCount: number } | null;
  draft: { version: number; revision: number; updatedAt: Date; source: string } | null;
}

const VERSION_SELECT = {
  id: true, version: true, status: true, revision: true, source: true, createdBy: true,
  createdAt: true, updatedAt: true, publishedAt: true, publishedBy: true, retiredAt: true,
} satisfies Prisma.TemplateVersionSelect;

const TAB_WHERE: Record<ListTemplatesQueryDto['tab'], Prisma.ChecklistTemplateWhereInput> = {
  enabled: { currentVersionId: { not: null }, disabledAt: null },
  draft: { versions: { some: { status: 'DRAFT' } } },
  disabled: { disabledAt: { not: null } },
};

interface CountRow { versionId: string; sections: number; items: number; critical: number }

@Injectable()
export class TemplateQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: ListTemplatesQueryDto): Promise<TemplateListEntry[]> {
    const templates = await this.prisma.checklistTemplate.findMany({
      where: {
        ...TAB_WHERE[query.tab],
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }] } : {}),
      },
      include: {
        currentVersion: { select: { id: true, version: true, publishedAt: true, publishedBy: true } },
        versions: { where: { status: 'DRAFT' }, select: { version: true, revision: true, updatedAt: true, source: true } },
      },
      orderBy: { code: 'asc' },
    });
    const currentIds = templates.flatMap((t) => (t.currentVersion ? [t.currentVersion.id] : []));
    const counts = new Map((await this.countTrees(currentIds)).map((row) => [row.versionId, row]));
    return templates.map((t) => {
      const count = t.currentVersion ? counts.get(t.currentVersion.id) : undefined;
      const draft = t.versions[0];
      return {
        id: t.id, code: t.code, name: t.name, category: t.category, disabledAt: t.disabledAt,
        current: t.currentVersion ? {
          version: t.currentVersion.version, publishedAt: t.currentVersion.publishedAt, publishedBy: t.currentVersion.publishedBy,
          sectionCount: count?.sections ?? 0, itemCount: count?.items ?? 0, criticalCount: count?.critical ?? 0,
        } : null,
        draft: draft ? { version: draft.version, revision: draft.revision, updatedAt: draft.updatedAt, source: draft.source } : null,
      };
    });
  }

  async get(id: string) {
    const template = await this.prisma.checklistTemplate.findUnique({
      where: { id }, include: { versions: { orderBy: { version: 'desc' }, select: VERSION_SELECT } },
    });
    if (!template) throw new NotFoundException('Checklist template not found');
    return template;
  }

  async getVersion(id: string, version: number) {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Checklist template not found');
    const found = await this.prisma.templateVersion.findUnique({
      where: { templateId_version: { templateId: id, version } }, include: TREE_INCLUDE,
    });
    if (!found) throw new NotFoundException('Template version not found');
    return { template, version: found };
  }

  async currentTree(templateId: string) {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } });
    if (!template) return null;
    const version = template.currentVersionId
      ? await this.prisma.templateVersion.findUnique({ where: { id: template.currentVersionId }, include: TREE_INCLUDE })
      : null;
    return { template, version };
  }

  private async countTrees(versionIds: string[]): Promise<CountRow[]> {
    if (versionIds.length === 0) return [];
    return this.prisma.$queryRaw<CountRow[]>`
      SELECT s."versionId" AS "versionId",
             count(DISTINCT s."id")::int AS "sections",
             count(i."id")::int AS "items",
             (count(i."id") FILTER (WHERE i."severity" = 'CRITICAL'))::int AS "critical"
      FROM "checklist_section" s
      LEFT JOIN "checklist_item" i ON i."sectionId" = s."id"
      WHERE s."versionId" = ANY(${versionIds}::uuid[])
      GROUP BY s."versionId"`;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter qc exec vitest run prisma/template-queries.integration.spec.ts && pnpm --filter qc typecheck`
Expected: PASS (6 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/qc/src/templates/template.queries.ts apps/qc/prisma/template-queries.integration.spec.ts
git commit -m "feat(qc): add template library reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Template routes, outbox drainer and service wiring

**Files:**
- Create: `apps/qc/src/templates/template.controller.ts`, `template.controller.spec.ts`
- Create: `apps/qc/src/outbox/outbox.drainer.ts`, `outbox.drainer.spec.ts`
- Modify: `apps/qc/src/app.module.ts`, `apps/qc/src/main.ts`
- Modify: `docker/env/qc.env`, `.env.example`

**Interfaces:**
- Consumes: `TemplateService` (Tasks 3–4), `TemplateQueries` (Task 5), request schemas (Task 1).
- Produces: HTTP routes under `/api/v1/qc/templates` (see spec §6.1, except the Excel routes which Task 8 adds): `GET /`, `GET /:id`, `GET /:id/versions/:version`, `POST /`, `PATCH /:id`, `POST /:id/draft`, `PUT /:id/draft`, `DELETE /:id/draft`, `POST /:id/publish`, `POST /:id/disable`, `POST /:id/enable`. `OutboxDrainer(prisma, bus)` with `drain(): Promise<void>`.

- [ ] **Step 1: Write the failing controller test**

Create `apps/qc/src/templates/template.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { TemplateController } from './template.controller.js';
import type { TemplateQueries } from './template.queries.js';
import type { TemplateService } from './template.service.js';

function permissionOf(method: keyof TemplateController): string | undefined {
  const handler = TemplateController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

describe('permissions', () => {
  const EXPECTED: [keyof TemplateController, string][] = [
    ['list', 'qc_template.view'], ['get', 'qc_template.view'], ['getVersion', 'qc_template.view'],
    ['create', 'qc_template.create'], ['rename', 'qc_template.update'],
    ['startDraft', 'qc_template.update'], ['saveDraft', 'qc_template.update'], ['discardDraft', 'qc_template.update'],
    ['publish', 'qc_template.publish'], ['disable', 'qc_template.publish'], ['enable', 'qc_template.publish'],
  ];
  for (const [method, permission] of EXPECTED) {
    it(`${String(method)} requires ${permission}`, () => { expect(permissionOf(method)).toBe(permission); });
  }
});

describe('parsing', () => {
  const service = { publish: vi.fn(), saveDraft: vi.fn() };
  const queries = { getVersion: vi.fn() };
  const controller = new TemplateController(service as unknown as TemplateService, queries as unknown as TemplateQueries);
  const req = { user: { id: 'u-1' } } as never;

  it('refuses an id that is not a uuid before the service is reached', () => {
    expect(() => controller.publish('nope', req)).toThrow();
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('refuses a version that is not a positive integer', () => {
    expect(() => controller.getVersion('0192f7a0-0000-7000-8000-000000000001', '0')).toThrow();
    expect(queries.getVersion).not.toHaveBeenCalled();
  });

  it('refuses a draft save without a revision', () => {
    expect(() => controller.saveDraft('0192f7a0-0000-7000-8000-000000000001', { document: { sections: [] } }, req)).toThrow();
    expect(service.saveDraft).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter qc exec vitest run src/templates/template.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Write the controller**

Create `apps/qc/src/templates/template.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import {
  CreateTemplateSchema, ListTemplatesQuerySchema, SaveDraftSchema, UpdateTemplateSchema,
  UuidSchema, VersionNumberSchema,
} from '@ipms/contracts';
import { TemplateQueries } from './template.queries.js';
import { TemplateService } from './template.service.js';

type Authed = { user: AuthzUser };

@Controller('qc/templates')
export class TemplateController {
  constructor(private readonly templates: TemplateService, private readonly queries: TemplateQueries) {}

  @Get() @RequirePermission('qc_template.view')
  list(@Query() query: unknown) { return this.queries.list(ListTemplatesQuerySchema.parse(query)); }

  @Get(':id') @RequirePermission('qc_template.view')
  get(@Param('id') id: string) { return this.queries.get(UuidSchema.parse(id)); }

  @Get(':id/versions/:version') @RequirePermission('qc_template.view')
  getVersion(@Param('id') id: string, @Param('version') version: string) {
    return this.queries.getVersion(UuidSchema.parse(id), VersionNumberSchema.parse(version));
  }

  @Post() @RequirePermission('qc_template.create')
  create(@Body() body: unknown, @Req() req: Authed) { return this.templates.create(CreateTemplateSchema.parse(body), req.user.id); }

  @Patch(':id') @RequirePermission('qc_template.update')
  rename(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.templates.rename(UuidSchema.parse(id), UpdateTemplateSchema.parse(body), req.user.id);
  }

  @Post(':id/draft') @RequirePermission('qc_template.update')
  startDraft(@Param('id') id: string, @Req() req: Authed) { return this.templates.startDraft(UuidSchema.parse(id), req.user.id); }

  @Put(':id/draft') @RequirePermission('qc_template.update')
  saveDraft(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.templates.saveDraft(UuidSchema.parse(id), SaveDraftSchema.parse(body), req.user.id);
  }

  @Delete(':id/draft') @RequirePermission('qc_template.update')
  discardDraft(@Param('id') id: string, @Req() req: Authed) { return this.templates.discardDraft(UuidSchema.parse(id), req.user.id); }

  @Post(':id/publish') @RequirePermission('qc_template.publish')
  publish(@Param('id') id: string, @Req() req: Authed) { return this.templates.publish(UuidSchema.parse(id), req.user.id); }

  @Post(':id/disable') @RequirePermission('qc_template.publish')
  disable(@Param('id') id: string, @Req() req: Authed) { return this.templates.disable(UuidSchema.parse(id), req.user.id); }

  @Post(':id/enable') @RequirePermission('qc_template.publish')
  enable(@Param('id') id: string, @Req() req: Authed) { return this.templates.enable(UuidSchema.parse(id), req.user.id); }
}
```

Run: `pnpm --filter qc exec vitest run src/templates/template.controller.spec.ts`
Expected: PASS (14 tests).

- [ ] **Step 3: Write the failing drainer test**

Create `apps/qc/src/outbox/outbox.drainer.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import type { EventBus } from '@ipms/events';
import { OutboxDrainer } from './outbox.drainer.js';

const row = { id: 'e-1', subject: 'audit.event.recorded', payload: { action: 'x' }, correlationId: 'c-1', actorId: 'u-1' };

function setup(publish: () => Promise<void>) {
  const prisma = { outboxEvent: { findMany: vi.fn().mockResolvedValue([row]), update: vi.fn() } };
  const bus = { publish: vi.fn(publish) };
  return { prisma, bus, drainer: new OutboxDrainer(prisma as unknown as PrismaClient, bus as unknown as EventBus) };
}

describe('OutboxDrainer.drain', () => {
  it('publishes pending rows with their event id and marks them published', async () => {
    const { prisma, bus, drainer } = setup(async () => {});
    await drainer.drain();
    expect(bus.publish).toHaveBeenCalledWith('audit.event.recorded', { action: 'x' }, { correlationId: 'c-1', eventId: 'e-1', actorId: 'u-1' });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({ where: { id: 'e-1' }, data: { publishedAt: expect.any(Date) } });
  });

  it('leaves a row pending when publishing fails, so the next poll retries', async () => {
    const { prisma, drainer } = setup(async () => { throw new Error('nats down'); });
    await drainer.drain();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter qc exec vitest run src/outbox/outbox.drainer.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the drainer (copied from `apps/iam/src/outbox/outbox.drainer.ts`, logger renamed)**

Create `apps/qc/src/outbox/outbox.drainer.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/qc';
import type { EventBus } from '@ipms/events';
import { createLogger } from '@ipms/observability';

const log = createLogger('qc');
const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 100;

@Injectable()
export class OutboxDrainer implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient, private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain().catch((err: unknown) => log.error({ err }, 'outbox drain failed'));
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    const pending = await this.prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: BATCH_SIZE });
    for (const row of pending) {
      try {
        await this.bus.publish(row.subject, row.payload, {
          correlationId: row.correlationId,
          eventId: row.id,
          ...(row.actorId === null ? {} : { actorId: row.actorId }),
        });
        await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date() } });
      } catch (err) {
        // Left pending; the next poll retries. Consumers dedupe on eventId.
        log.warn({ err, outboxId: row.id, subject: row.subject }, 'outbox publish failed, will retry');
      }
    }
  }
}
```

If `bus.publish`'s parameter types reject `row.payload` (Prisma `JsonValue`), use the same cast IAM's drainer compiles with — check `apps/iam/src/outbox/outbox.drainer.ts` and mirror it exactly.

Run: `pnpm --filter qc exec vitest run src/outbox/outbox.drainer.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the module and bootstrap**

In `apps/qc/src/app.module.ts`:

1. Add imports:

```ts
import { EventBus } from '@ipms/events';
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { TemplateController } from './templates/template.controller.js';
import { TemplateQueries } from './templates/template.queries.js';
import { TemplateService } from './templates/template.service.js';
```

2. Add a helper below `graceDays`:

```ts
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
```

3. Set `controllers: [TemplateController, SubmissionController, HealthController, MetricsController]`.

4. Append to `providers`:

```ts
    {
      provide: EventBus,
      useFactory: async (): Promise<EventBus> => {
        const bus = new EventBus();
        await bus.connect(requireEnv('NATS_URL'));
        await bus.ensureStreams();
        registerReadinessCheck('nats', () => bus.isHealthy());
        return bus;
      },
    },
    { provide: OutboxDrainer, useFactory: (prisma: PrismaService, bus: EventBus) => new OutboxDrainer(prisma.db, bus), inject: [PrismaService, EventBus] },
    { provide: TemplateService, useFactory: (prisma: PrismaService) => new TemplateService(prisma.db), inject: [PrismaService] },
    { provide: TemplateQueries, useFactory: (prisma: PrismaService) => new TemplateQueries(prisma.db), inject: [PrismaService] },
```

Replace `apps/qc/src/main.ts` (adds the uniform error envelope, which web forms rely on, and multipart for Task 8):

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter, createLogger } from '@ipms/observability';
import { TEMPLATE_IMPORT_FILE_BYTES } from '@ipms/contracts';
import { AppModule } from './app.module.js';

const log = createLogger('qc');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  await app.register(import('@fastify/multipart'), { limits: { fileSize: TEMPLATE_IMPORT_FILE_BYTES, files: 1 } });
  app.useGlobalFilters(new GlobalExceptionFilter('qc'));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  const port = Number(process.env['PORT'] ?? 3005);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'qc service listening');
}

bootstrap().catch((err: unknown) => { log.fatal({ err }, 'qc service failed to start'); process.exit(1); });
```

Append to `docker/env/qc.env`:

```
QC_RETIRED_VERSION_GRACE_DAYS=7
```

Append to `.env.example` after the `PROJECT_INTERNAL_URL` line:

```
# How long qc still accepts submissions against a template version after a newer one is published.
QC_RETIRED_VERSION_GRACE_DAYS=7
```

- [ ] **Step 6: Run everything in qc and build it**

Run: `pnpm --filter qc exec vitest run && pnpm --filter qc typecheck && pnpm --filter qc build`
Expected: all PASS; typecheck and build clean.

- [ ] **Step 7: Smoke-test the routes against the Compose stack**

Run: `docker compose -f docker/docker-compose.yml up -d --build qc`
Then:

```bash
TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'content-type: application/json' -d '{"username":"qc","password":"demo12345"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s -X POST localhost:3000/api/v1/qc/templates -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"code":"SMOKE-1","name":"Smoke","category":"QUALITY"}'
curl -s "localhost:3000/api/v1/qc/templates?tab=draft" -H "authorization: Bearer $TOKEN"
```

Expected: the POST returns `{"templateId":"…","draft":{"version":1,"revision":1,…}}`; the list contains `SMOKE-1`. If the demo password differs, use the value of `IAM_DEMO_PASSWORD` in `docker/env/iam.env`.

- [ ] **Step 8: Commit**

```bash
git add apps/qc/src docker/env/qc.env .env.example
git commit -m "feat(qc): expose the template library over HTTP with audited lifecycle events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Excel workbook builder and parser

**Files:**
- Create: `apps/qc/src/templates/excel/columns.ts`
- Create: `apps/qc/src/templates/excel/workbook.ts`
- Create: `apps/qc/src/templates/excel/parse.ts`
- Create: `apps/qc/src/templates/excel/parse.spec.ts`

**Interfaces:**
- Consumes: `TemplateDocument`, `TemplateMetadata`, `ImportRowError`, `PublishableDocumentSchema`, `TemplateCodeSchema`, `TEMPLATE_MAX_ITEMS` (Task 1).
- Produces:
  - `buildWorkbook(source: WorkbookSource): Promise<Buffer>` where `WorkbookSource = { metadata: TemplateMetadata | null; version: { version: number; status: string; publishedAt: Date | null } | null; document: TemplateDocument }`.
  - `EXAMPLE_DOCUMENT: TemplateDocument` (the blank workbook's sample rows).
  - `parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook>` where `ParsedWorkbook = { metadata: TemplateMetadata | null; document: TemplateDocument | null; errors: ImportRowError[] }`. `document` is non-null only when `errors` is empty.

- [ ] **Step 1: Write the failing test**

Create `apps/qc/src/templates/excel/parse.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { TemplateDocumentSchema, type TemplateDocument } from '@ipms/contracts';
import { EXAMPLE_DOCUMENT, buildWorkbook } from './workbook.js';
import { parseWorkbook } from './parse.js';

const META_ROWS = [['Field', 'Value'], ['Code', 'AI-RRU'], ['Name', 'Antenna + RRU'], ['Category', 'Quality']];
const HEADER = ['Section No', 'Section Title', 'Item No', 'Requirement'];

async function workbookOf(rows: (string | number)[][], header: string[] = HEADER, meta: string[][] = META_ROWS): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const template = workbook.addWorksheet('Template');
  meta.forEach((row) => template.addRow(row));
  const checklist = workbook.addWorksheet('Checklist');
  checklist.addRow(header);
  rows.forEach((row) => checklist.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const FULL: TemplateDocument = TemplateDocumentSchema.parse({
  sections: [
    { number: '1', title: 'EHS On Site', items: [
      { number: '1.1', requirementText: 'PPE worn', severity: 'CRITICAL', minPhotos: 1, maxPhotos: 3, guidanceText: 'Helmet, harness, boots' },
      { number: '1.2', requirementText: 'Barricaded', responseType: 'BOOLEAN', minPhotos: 1, maxPhotos: 2 },
      { number: '1.3', requirementText: 'Remarks', responseType: 'TEXT', isRequired: false },
    ] },
    { number: '2', title: 'Antenna', items: [
      { number: '2.1', requirementText: 'Azimuth', responseType: 'NUMBER', allowsNa: true, maxPhotos: 1, minPhotos: 1 },
      { number: '2.2', requirementText: 'Mount type', responseType: 'SELECT', selectOptions: ['Pole', 'Wall', 'Tower'] },
    ] },
  ],
});

describe('round-trip', () => {
  it('exporting a version and importing the file unchanged yields the same document', async () => {
    const file = await buildWorkbook({
      metadata: { code: 'AI-RRU', name: 'Antenna + RRU', category: 'EHS' },
      version: { version: 3, status: 'PUBLISHED', publishedAt: new Date('2026-09-01T00:00:00Z') },
      document: FULL,
    });
    const parsed = await parseWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.metadata).toEqual({ code: 'AI-RRU', name: 'Antenna + RRU', category: 'EHS' });
    expect(parsed.document).toEqual(FULL);
  });

  it('the blank workbook carries the example rows and asks for metadata', async () => {
    const parsed = await parseWorkbook(await buildWorkbook({ metadata: null, version: null, document: EXAMPLE_DOCUMENT }));
    expect(parsed.errors.map((e) => e.column)).toEqual(['Code', 'Name', 'Category']);
    const filled = await buildWorkbook({ metadata: { code: 'X', name: 'X', category: 'OTHER' }, version: null, document: EXAMPLE_DOCUMENT });
    expect((await parseWorkbook(filled)).document).toEqual(EXAMPLE_DOCUMENT);
  });
});

describe('sections', () => {
  it('continues a section across blank section cells, and across repeated identical ones', async () => {
    const parsed = await parseWorkbook(await workbookOf([
      ['1', 'EHS', '1.1', 'PPE'], ['', '', '1.2', 'Barricade'], ['1', 'EHS', '1.3', 'Signage'], ['2', 'Antenna', '2.1', 'Azimuth'],
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.sections.map((s) => [s.number, s.items.length])).toEqual([['1', 3], ['2', 1]]);
  });

  it('reports a section number that reappears with a different title', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE'], ['1', 'Safety', '1.2', 'Barricade']]));
    expect(parsed.errors).toEqual([{ row: 3, column: 'Section Title', message: 'Section 1 already has the title "EHS"' }]);
  });

  it('reports a section that is not contiguous', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE'], ['2', 'Antenna', '2.1', 'Az'], ['1', 'EHS', '1.2', 'Barricade']]));
    expect(parsed.errors).toEqual([{ row: 4, column: 'Section No', message: 'Sections must be contiguous: section 1 appeared earlier' }]);
  });

  it('reports a first row that starts no section', async () => {
    const parsed = await parseWorkbook(await workbookOf([['', '', '1.1', 'PPE']]));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Section No', message: 'The first row must start a section' }]);
  });

  it('reports an empty section at its heading row', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '', ''], ['2', 'Antenna', '2.1', 'Az']]));
    expect(parsed.errors).toEqual([{ row: 2, column: null, message: 'Every section needs at least one item' }]);
  });
});

describe('values', () => {
  const FULL_HEADER = ['Section No', 'Section Title', 'Item No', 'Requirement', 'Severity', 'Response Type', 'Options', 'Min Photos', 'Max Photos', 'Allow N/A', 'Required', 'Guidance'];

  it('is lenient about case and synonyms', async () => {
    const parsed = await parseWorkbook(await workbookOf([
      ['1', 'EHS', '1.1', 'Barricaded', 'critical', 'boolean', '', '0', '0', 'y', 'FALSE', ''],
      ['', '', '1.2', 'Mount', 'NORMAL', 'select', 'Pole ; Wall', '0', '0', '1', 'true', ''],
    ], FULL_HEADER));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.sections[0]!.items[0]).toMatchObject({ severity: 'CRITICAL', responseType: 'BOOLEAN', allowsNa: true, isRequired: false });
    expect(parsed.document!.sections[0]!.items[1]).toMatchObject({ responseType: 'SELECT', selectOptions: ['Pole', 'Wall'], allowsNa: true });
  });

  it('takes defaults when optional columns are absent', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE']]));
    expect(parsed.document!.sections[0]!.items[0]).toEqual({
      number: '1.1', requirementText: 'PPE', severity: 'NORMAL', responseType: 'RESULT_ONLY',
      selectOptions: [], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true,
    });
  });

  it('reports an unknown value at its cell', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', 'Severe']], [...HEADER, 'Severity']));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Severity', message: 'Use one of: Normal, Critical' }]);
  });

  it('maps a schema error back to its row and column', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', '2', '1']], [...HEADER, 'Min Photos', 'Max Photos']));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Max Photos', message: 'Must be at least Min Photos (2)' }]);
  });

  it('skips blank rows', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE'], ['', '', '', ''], ['', '', '1.2', 'Barricade']]));
    expect(parsed.document!.sections[0]!.items).toHaveLength(2);
  });
});

describe('file-level problems', () => {
  it('reports a missing required column', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1']], ['Section No', 'Section Title', 'Item No']));
    expect(parsed.errors).toEqual([{ row: 1, column: 'Requirement', message: 'The Checklist sheet needs a "Requirement" column' }]);
  });

  it('reports a bad code on the Template sheet', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE']], HEADER, [['Field', 'Value'], ['Code', 'ai rru'], ['Name', 'X'], ['Category', 'Quality']]));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Code', message: 'Use upper case letters, digits, dash or underscore (at most 50)' }]);
  });

  it('reports a file that is not a workbook', async () => {
    expect((await parseWorkbook(Buffer.from('not a workbook'))).errors[0]!.message).toBe('That file could not be read as an Excel workbook');
  });

  it('refuses more than 1,000 items', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => (i === 0 ? ['1', 'EHS', 'x0', 'r'] : ['', '', `x${i}`, 'r']));
    const parsed = await parseWorkbook(await workbookOf(rows));
    expect(parsed.errors[0]!.message).toContain('more than 1000 items');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter qc exec vitest run src/templates/excel/parse.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the column definitions**

Create `apps/qc/src/templates/excel/columns.ts`:

```ts
import type { ResponseType, Severity, TemplateCategory } from '@ipms/contracts';

export const SHEETS = { template: 'Template', checklist: 'Checklist', instructions: 'Instructions' } as const;

export const COLUMNS = [
  { key: 'sectionNo', header: 'Section No', width: 12 },
  { key: 'sectionTitle', header: 'Section Title', width: 28 },
  { key: 'itemNo', header: 'Item No', width: 10 },
  { key: 'requirement', header: 'Requirement', width: 60 },
  { key: 'severity', header: 'Severity', width: 12 },
  { key: 'responseType', header: 'Response Type', width: 16 },
  { key: 'options', header: 'Options', width: 30 },
  { key: 'minPhotos', header: 'Min Photos', width: 12 },
  { key: 'maxPhotos', header: 'Max Photos', width: 12 },
  { key: 'allowNa', header: 'Allow N/A', width: 11 },
  { key: 'required', header: 'Required', width: 11 },
  { key: 'guidance', header: 'Guidance', width: 50 },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]['key'];
export const REQUIRED_COLUMNS: readonly ColumnKey[] = ['sectionNo', 'sectionTitle', 'itemNo', 'requirement'];

export function headerOf(key: ColumnKey): string {
  return COLUMNS.find((column) => column.key === key)!.header;
}

/** Case- and punctuation-blind, so "Allow N/A", "allow na" and "ALLOW_NA" all match. */
export function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const CATEGORY_LABELS: Record<TemplateCategory, string> = { QUALITY: 'Quality', EHS: 'EHS', OTHER: 'Other' };
export const SEVERITY_LABELS: Record<Severity, string> = { NORMAL: 'Normal', CRITICAL: 'Critical' };
export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  RESULT_ONLY: 'Result only', TEXT: 'Text', NUMBER: 'Number', BOOLEAN: 'Yes/No', SELECT: 'Select',
};

export const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

function lookup<T extends string>(labels: Record<T, string>, synonyms: Record<string, T> = {}): (text: string) => T | undefined {
  const map = new Map<string, T>();
  for (const [value, label] of Object.entries(labels) as [T, string][]) {
    map.set(normalizeHeader(label), value);
    map.set(normalizeHeader(value), value);
  }
  for (const [text, value] of Object.entries(synonyms)) map.set(normalizeHeader(text), value);
  return (text) => map.get(normalizeHeader(text));
}

export const parseCategory = lookup(CATEGORY_LABELS);
export const parseSeverity = lookup(SEVERITY_LABELS);
export const parseResponseType = lookup(RESPONSE_TYPE_LABELS, { result: 'RESULT_ONLY' });

const BOOLEANS = new Map<string, boolean>([
  ['yes', true], ['y', true], ['true', true], ['1', true],
  ['no', false], ['n', false], ['false', false], ['0', false],
]);
export const parseBoolean = (text: string): boolean | undefined => BOOLEANS.get(text.trim().toLowerCase());
```

- [ ] **Step 4: Write the workbook builder**

Create `apps/qc/src/templates/excel/workbook.ts`:

```ts
import ExcelJS from 'exceljs';
import type { TemplateDocument, TemplateMetadata } from '@ipms/contracts';
import { CATEGORY_LABELS, COLUMNS, RESPONSE_TYPE_LABELS, SEVERITY_LABELS, SHEETS, yesNo, type ColumnKey } from './columns.js';

export interface WorkbookSource {
  metadata: TemplateMetadata | null;
  version: { version: number; status: string; publishedAt: Date | null } | null;
  document: TemplateDocument;
}

export const EXAMPLE_DOCUMENT: TemplateDocument = {
  sections: [
    { number: '1', title: 'EHS On Site', items: [
      { number: '1.1', requirementText: 'All crew wear helmet, harness and safety boots', severity: 'CRITICAL', responseType: 'RESULT_ONLY', selectOptions: [], minPhotos: 1, maxPhotos: 3, allowsNa: false, isRequired: true, guidanceText: 'Show every crew member in frame' },
      { number: '1.2', requirementText: 'Work area barricaded', severity: 'NORMAL', responseType: 'BOOLEAN', selectOptions: [], minPhotos: 1, maxPhotos: 2, allowsNa: false, isRequired: true },
    ] },
    { number: '2', title: 'Antenna Installation', items: [
      { number: '2.1', requirementText: 'Azimuth (degrees)', severity: 'NORMAL', responseType: 'NUMBER', selectOptions: [], minPhotos: 1, maxPhotos: 1, allowsNa: true, isRequired: true },
      { number: '2.2', requirementText: 'Mount type', severity: 'NORMAL', responseType: 'SELECT', selectOptions: ['Pole', 'Wall', 'Tower'], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true },
      { number: '2.3', requirementText: 'Installer remarks', severity: 'NORMAL', responseType: 'TEXT', selectOptions: [], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: false },
    ] },
  ],
};

const INSTRUCTIONS = [
  'One row per checklist item, in the order the field engineer should see them.',
  'Fill Section No and Section Title on the first row of a section. Leave them blank on the rows below to stay in that section.',
  'Section numbers must be unique, and a section\'s rows must be together. Item numbers must be unique within their section.',
  'Item No and Requirement are required on every item row.',
  'Severity: Normal or Critical. Blank means Normal.',
  'Response Type: Result only, Text, Number, Yes/No or Select. Blank means Result only.',
  'Options: only for Select items. Separate 2 to 50 choices with a semicolon, e.g. "Pole; Wall; Tower".',
  'Min Photos / Max Photos: 0 to 20. Min 0 makes photos optional up to Max; Max 0 means no photos.',
  'Allow N/A: Yes or No (blank means No). Required: Yes or No (blank means Yes).',
  'Guidance: optional instructions shown to the field engineer.',
  'On the Template sheet, Code (upper case letters, digits, dash, underscore), Name and Category (Quality, EHS, Other) are required.',
  'Importing a file whose Code already exists makes it the next draft of that template. Nothing is saved until you confirm the preview.',
];

const VALIDATED_ROWS = 1000;
const listOf = (values: string[]) => ({ type: 'list' as const, allowBlank: true, formulae: [`"${values.join(',')}"`] });
const columnNumber = (key: ColumnKey): number => COLUMNS.findIndex((column) => column.key === key) + 1;

export async function buildWorkbook(source: WorkbookSource): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const meta = workbook.addWorksheet(SHEETS.template);
  meta.addRow(['Field', 'Value']);
  meta.getRow(1).font = { bold: true };
  meta.addRow(['Code', source.metadata?.code ?? '']);
  meta.addRow(['Name', source.metadata?.name ?? '']);
  meta.addRow(['Category', source.metadata ? CATEGORY_LABELS[source.metadata.category] : '']);
  meta.getCell('B4').dataValidation = listOf(Object.values(CATEGORY_LABELS));
  if (source.version) {
    meta.addRow(['Version', source.version.version]);
    meta.addRow(['Status', source.version.status]);
    meta.addRow(['Published At', source.version.publishedAt?.toISOString() ?? '']);
  }
  meta.getColumn(1).width = 14;
  meta.getColumn(2).width = 50;

  const sheet = workbook.addWorksheet(SHEETS.checklist);
  sheet.addRow(COLUMNS.map((column) => column.header));
  sheet.getRow(1).font = { bold: true };
  COLUMNS.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  for (const section of source.document.sections) {
    // A draft may hold an empty section; it exports as a heading row so it survives the round-trip.
    if (section.items.length === 0) sheet.addRow([section.number, section.title]);
    section.items.forEach((item, index) => {
      sheet.addRow([
        index === 0 ? section.number : '', index === 0 ? section.title : '',
        item.number, item.requirementText, SEVERITY_LABELS[item.severity], RESPONSE_TYPE_LABELS[item.responseType],
        item.selectOptions.join('; '), item.minPhotos, item.maxPhotos, yesNo(item.allowsNa), yesNo(item.isRequired),
        item.guidanceText ?? '',
      ]);
    });
  }
  for (let row = 2; row <= VALIDATED_ROWS + 1; row += 1) {
    sheet.getCell(row, columnNumber('severity')).dataValidation = listOf(Object.values(SEVERITY_LABELS));
    sheet.getCell(row, columnNumber('responseType')).dataValidation = listOf(Object.values(RESPONSE_TYPE_LABELS));
    sheet.getCell(row, columnNumber('allowNa')).dataValidation = listOf(['Yes', 'No']);
    sheet.getCell(row, columnNumber('required')).dataValidation = listOf(['Yes', 'No']);
  }

  const help = workbook.addWorksheet(SHEETS.instructions);
  for (const line of INSTRUCTIONS) help.addRow([line]);
  help.getColumn(1).width = 120;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

- [ ] **Step 5: Write the parser**

Create `apps/qc/src/templates/excel/parse.ts`:

```ts
import ExcelJS from 'exceljs';
import {
  PublishableDocumentSchema, TEMPLATE_MAX_ITEMS, TemplateCodeSchema,
  type ImportRowError, type TemplateDocument, type TemplateMetadata,
} from '@ipms/contracts';
import {
  COLUMNS, REQUIRED_COLUMNS, SHEETS, headerOf, normalizeHeader,
  parseBoolean, parseCategory, parseResponseType, parseSeverity, type ColumnKey,
} from './columns.js';

export interface ParsedWorkbook {
  metadata: TemplateMetadata | null;
  document: TemplateDocument | null;
  errors: ImportRowError[];
}

type Cells = Partial<Record<ColumnKey, string>>;
type CellError = (key: ColumnKey, message: string) => void;
interface RowItem { row: number; values: Record<string, unknown> }
interface RowSection { row: number; number: string; title: string; items: RowItem[] }

const FIELD_COLUMNS: Record<string, ColumnKey> = {
  number: 'itemNo', requirementText: 'requirement', severity: 'severity', responseType: 'responseType',
  selectOptions: 'options', minPhotos: 'minPhotos', maxPhotos: 'maxPhotos', allowsNa: 'allowNa',
  isRequired: 'required', guidanceText: 'guidance',
};

const cellText = (cell: ExcelJS.Cell): string => String(cell.text ?? '').trim();

function findSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === name.toLowerCase());
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs ships an older, non-generic Buffer type; identical at runtime.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { metadata: null, document: null, errors: [{ row: null, column: null, message: 'That file could not be read as an Excel workbook' }] };
  }
  const errors: ImportRowError[] = [];
  const metadata = readMetadata(workbook, errors);
  const sections = readChecklist(workbook, errors);
  if (errors.length > 0 || !metadata || !sections) return { metadata, document: null, errors };

  const checked = PublishableDocumentSchema.safeParse({
    sections: sections.map((section) => ({ number: section.number, title: section.title, items: section.items.map((item) => item.values) })),
  });
  if (!checked.success) {
    return { metadata, document: null, errors: checked.error.issues.map((issue) => locate(issue.path, issue.message, sections)) };
  }
  return { metadata, document: checked.data, errors: [] };
}

function readMetadata(workbook: ExcelJS.Workbook, errors: ImportRowError[]): TemplateMetadata | null {
  const sheet = findSheet(workbook, SHEETS.template);
  if (!sheet) { errors.push({ row: null, column: null, message: 'The workbook needs a "Template" sheet' }); return null; }
  const fields = new Map<string, { row: number; value: string }>();
  sheet.eachRow((row, rowNumber) => {
    const field = normalizeHeader(cellText(row.getCell(1)));
    if (field) fields.set(field, { row: rowNumber, value: cellText(row.getCell(2)) });
  });
  const required = (field: string, label: string) => {
    const found = fields.get(field);
    if (!found || !found.value) { errors.push({ row: found?.row ?? null, column: label, message: `${label} is required on the Template sheet` }); return null; }
    return found;
  };
  const code = required('code', 'Code');
  const name = required('name', 'Name');
  const category = required('category', 'Category');
  if (!code || !name || !category) return null;

  const parsedCode = TemplateCodeSchema.safeParse(code.value);
  if (!parsedCode.success) errors.push({ row: code.row, column: 'Code', message: 'Use upper case letters, digits, dash or underscore (at most 50)' });
  const nameTooLong = name.value.length > 250;
  if (nameTooLong) errors.push({ row: name.row, column: 'Name', message: 'At most 250 characters' });
  const parsedCategory = parseCategory(category.value);
  if (!parsedCategory) errors.push({ row: category.row, column: 'Category', message: 'Use one of: Quality, EHS, Other' });
  if (!parsedCode.success || nameTooLong || !parsedCategory) return null;
  return { code: parsedCode.data, name: name.value, category: parsedCategory };
}

function readChecklist(workbook: ExcelJS.Workbook, errors: ImportRowError[]): RowSection[] | null {
  const sheet = findSheet(workbook, SHEETS.checklist);
  if (!sheet) { errors.push({ row: null, column: null, message: 'The workbook needs a "Checklist" sheet' }); return null; }

  const byHeader = new Map<string, ColumnKey>(COLUMNS.map((column) => [normalizeHeader(column.header), column.key]));
  const positions = new Map<number, ColumnKey>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const key = byHeader.get(normalizeHeader(cellText(cell)));
    if (key) positions.set(colNumber, key);
  });
  const present = new Set(positions.values());
  const missing = REQUIRED_COLUMNS.filter((key) => !present.has(key));
  if (missing.length > 0) {
    for (const key of missing) errors.push({ row: 1, column: headerOf(key), message: `The Checklist sheet needs a "${headerOf(key)}" column` });
    return null;
  }

  const sections: RowSection[] = [];
  const seen = new Set<string>();
  let itemCount = 0;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: Cells = {};
    for (const [colNumber, key] of positions) {
      const value = cellText(row.getCell(colNumber));
      if (value) cells[key] = value;
    }
    if (Object.keys(cells).length === 0) continue;
    const error: CellError = (key, message) => { errors.push({ row: rowNumber, column: headerOf(key), message }); };

    let current = sections.at(-1);
    if (cells.sectionNo !== undefined || cells.sectionTitle !== undefined) {
      if (cells.sectionNo === undefined) { error('sectionNo', 'A section needs a number'); continue; }
      if (cells.sectionTitle === undefined) { error('sectionTitle', 'A section needs a title'); continue; }
      if (current && current.number === cells.sectionNo) {
        if (current.title !== cells.sectionTitle) error('sectionTitle', `Section ${cells.sectionNo} already has the title "${current.title}"`);
      } else if (seen.has(cells.sectionNo)) {
        error('sectionNo', `Sections must be contiguous: section ${cells.sectionNo} appeared earlier`);
        continue;
      } else {
        current = { row: rowNumber, number: cells.sectionNo, title: cells.sectionTitle, items: [] };
        sections.push(current);
        seen.add(cells.sectionNo);
      }
    }
    if (!current) { error('sectionNo', 'The first row must start a section'); continue; }
    // A heading row on its own: the section starts here, its items follow.
    if (cells.itemNo === undefined && cells.requirement === undefined) continue;
    itemCount += 1;
    if (itemCount > TEMPLATE_MAX_ITEMS) {
      errors.push({ row: rowNumber, column: null, message: `This file has more than ${TEMPLATE_MAX_ITEMS} items. Split the checklist into smaller templates.` });
      return null;
    }
    current.items.push({ row: rowNumber, values: readItem(cells, error) });
  }
  if (sections.length === 0 && errors.length === 0) {
    errors.push({ row: null, column: null, message: 'The Checklist sheet has a header row and no items' });
  }
  return sections;
}

function readItem(cells: Cells, error: CellError): Record<string, unknown> {
  const values: Record<string, unknown> = { number: cells.itemNo ?? '', requirementText: cells.requirement ?? '' };
  const pick = <T>(key: ColumnKey, parse: (text: string) => T | undefined, allowed: string, field: string): void => {
    const raw = cells[key];
    if (raw === undefined) return;
    const parsed = parse(raw);
    if (parsed === undefined) { error(key, `Use one of: ${allowed}`); return; }
    values[field] = parsed;
  };
  pick('severity', parseSeverity, 'Normal, Critical', 'severity');
  pick('responseType', parseResponseType, 'Result only, Text, Number, Yes/No, Select', 'responseType');
  pick('allowNa', parseBoolean, 'Yes, No', 'allowsNa');
  pick('required', parseBoolean, 'Yes, No', 'isRequired');
  for (const key of ['minPhotos', 'maxPhotos'] as const) {
    const raw = cells[key];
    if (raw === undefined) continue;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0 || count > 20) { error(key, 'Must be a whole number from 0 to 20'); continue; }
    values[key] = count;
  }
  if (cells.options !== undefined) values['selectOptions'] = cells.options.split(';').map((option) => option.trim()).filter(Boolean);
  if (cells.guidance !== undefined) values['guidanceText'] = cells.guidance;
  return values;
}

function locate(path: PropertyKey[], message: string, sections: RowSection[]): ImportRowError {
  const [, sectionIndex, part, itemIndex, field] = path;
  const section = typeof sectionIndex === 'number' ? sections[sectionIndex] : undefined;
  if (!section) return { row: null, column: null, message };
  if (part === 'items' && typeof itemIndex === 'number') {
    const key = typeof field === 'string' ? FIELD_COLUMNS[field] : undefined;
    return { row: section.items[itemIndex]?.row ?? section.row, column: key ? headerOf(key) : null, message };
  }
  if (part === 'items') return { row: section.row, column: null, message };
  return { row: section.row, column: part === 'title' ? 'Section Title' : 'Section No', message };
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter qc exec vitest run src/templates/excel && pnpm --filter qc typecheck`
Expected: PASS (16 tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/qc/src/templates/excel
git commit -m "feat(qc): read and write checklist templates as Excel workbooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Excel routes — blank, export, import preview and commit

**Files:**
- Create: `apps/qc/src/templates/template-import.service.ts`
- Create: `apps/qc/src/templates/template-import.controller.ts`, `template-import.controller.spec.ts`
- Create: `apps/qc/prisma/template-import.integration.spec.ts`
- Modify: `apps/qc/src/app.module.ts`

**Interfaces:**
- Consumes: `parseWorkbook`, `buildWorkbook`, `EXAMPLE_DOCUMENT` (Task 7); `TemplateService.createFromImport`, `importIntoDraft`, `CreatedDraft` (Task 3); `TemplateQueries.getVersion` (Task 5); `toDocument` (Task 3); `ImportCommitSchema`, `TemplateImportPreview`, `ImportTarget` (Task 1).
- Produces: `class TemplateImportService { preview(buffer: Buffer): Promise<TemplateImportPreview>; commit(dto: ImportCommitDto, actorId: string): Promise<CreatedDraft> }`; routes `GET /qc/templates/import/blank`, `GET /qc/templates/:id/versions/:version/export`, `POST /qc/templates/import/preview` (multipart `file`), `POST /qc/templates/import/commit`.

- [ ] **Step 1: Write the failing integration test**

Create `apps/qc/prisma/template-import.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { TemplateImportService } from '../src/templates/template-import.service.js';
import { TemplateService } from '../src/templates/template.service.js';
import { EXAMPLE_DOCUMENT, buildWorkbook } from '../src/templates/excel/workbook.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let templates: TemplateService;
let imports: TemplateImportService;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  templates = new TemplateService(prisma);
  imports = new TemplateImportService(prisma, templates);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const file = (code: string, name = 'Antenna + RRU') =>
  buildWorkbook({ metadata: { code, name, category: 'QUALITY' }, version: null, document: EXAMPLE_DOCUMENT });

describe('preview', () => {
  it('targets a new template and summarizes the document, writing nothing', async () => {
    const preview = await imports.preview(await file('NEW-1'));
    expect(preview.target).toEqual({ kind: 'NEW' });
    expect(preview.summary).toEqual({ sections: 2, items: 5, critical: 1, withPhotos: 3 });
    expect(await prisma.checklistTemplate.count()).toBe(0);
  });

  it('targets the next version of an existing template and warns about differences', async () => {
    const { templateId } = await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    const preview = await imports.preview(await file('AI-RRU', 'Different name'));
    expect(preview.target).toMatchObject({ kind: 'EXISTING', templateId, replacesDraft: null, nextVersion: 2 });
    expect(preview.warnings[0]).toContain('An import never renames a template');
  });

  it('warns that an existing draft will be replaced', async () => {
    const { templateId } = await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    await templates.startDraft(templateId, ACTOR);
    const preview = await imports.preview(await file('AI-RRU'));
    expect(preview.target).toMatchObject({ replacesDraft: { version: 2, revision: 1 }, nextVersion: 2 });
    expect(preview.warnings).toContain('This replaces the current v2 draft.');
  });

  it('returns row errors and no document for a broken file', async () => {
    const preview = await imports.preview(Buffer.from('nope'));
    expect(preview.document).toBeNull();
    expect(preview.errors).toHaveLength(1);
  });
});

describe('commit', () => {
  it('creates a new template from the file', async () => {
    const created = await imports.commit({ code: 'NEW-1', name: 'New', category: 'EHS', document: EXAMPLE_DOCUMENT }, ACTOR);
    expect(created.draft).toMatchObject({ version: 1, source: 'EXCEL_IMPORT' });
  });

  it('replaces an existing draft only at the previewed revision', async () => {
    const { templateId } = await seedPublishedTemplate(prisma, { code: 'AI-RRU' });
    await templates.startDraft(templateId, ACTOR);
    const dto = { code: 'AI-RRU', name: 'x', category: 'QUALITY' as const, document: EXAMPLE_DOCUMENT };
    await expect(imports.commit({ ...dto, expectedDraftRevision: 7 }, ACTOR)).rejects.toThrow('Preview the file again');
    const created = await imports.commit({ ...dto, expectedDraftRevision: 1 }, ACTOR);
    expect(created).toMatchObject({ templateId, draft: { version: 2, revision: 2, source: 'EXCEL_IMPORT' } });
  });
});
```

Run: `pnpm --filter qc exec vitest run prisma/template-import.integration.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Write the import service**

Create `apps/qc/src/templates/template-import.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/qc';
import type { ImportCommitDto, ImportTarget, TemplateCategory, TemplateImportPreview } from '@ipms/contracts';
import { parseWorkbook } from './excel/parse.js';
import type { CreatedDraft, TemplateService } from './template.service.js';

@Injectable()
export class TemplateImportService {
  constructor(private readonly prisma: PrismaClient, private readonly templates: TemplateService) {}

  async preview(buffer: Buffer): Promise<TemplateImportPreview> {
    const parsed = await parseWorkbook(buffer);
    if (parsed.errors.length > 0 || !parsed.metadata || !parsed.document) {
      return { metadata: parsed.metadata, target: null, warnings: [], errors: parsed.errors, document: null, summary: null };
    }
    const { metadata, document } = parsed;
    const existing = await this.prisma.checklistTemplate.findUnique({
      where: { code: metadata.code }, include: { versions: { select: { version: true, status: true, revision: true } } },
    });
    const warnings: string[] = [];
    let target: ImportTarget = { kind: 'NEW' };
    if (existing) {
      const draft = existing.versions.find((version) => version.status === 'DRAFT');
      const latest = Math.max(0, ...existing.versions.map((version) => version.version));
      target = {
        kind: 'EXISTING', templateId: existing.id, name: existing.name, category: existing.category as TemplateCategory,
        replacesDraft: draft ? { version: draft.version, revision: draft.revision } : null,
        nextVersion: draft ? draft.version : latest + 1,
      };
      if (existing.name !== metadata.name) {
        warnings.push(`The file names this template "${metadata.name}", but it is called "${existing.name}". An import never renames a template; rename it on the template page.`);
      }
      if (existing.category !== metadata.category) {
        warnings.push(`The file's category (${metadata.category}) differs from the template's (${existing.category}). An import never changes the category.`);
      }
      if (draft) warnings.push(`This replaces the current v${draft.version} draft.`);
    }
    const items = document.sections.flatMap((section) => section.items);
    return {
      metadata, target, warnings, errors: [], document,
      summary: {
        sections: document.sections.length, items: items.length,
        critical: items.filter((item) => item.severity === 'CRITICAL').length,
        withPhotos: items.filter((item) => item.maxPhotos > 0).length,
      },
    };
  }

  async commit(dto: ImportCommitDto, actorId: string): Promise<CreatedDraft> {
    const existing = await this.prisma.checklistTemplate.findUnique({ where: { code: dto.code } });
    if (!existing) {
      return this.templates.createFromImport({ code: dto.code, name: dto.name, category: dto.category }, dto.document, actorId);
    }
    return this.templates.importIntoDraft(existing.id, dto.document, dto.expectedDraftRevision, actorId);
  }
}
```

Run: `pnpm --filter qc exec vitest run prisma/template-import.integration.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Write the failing controller test**

Create `apps/qc/src/templates/template-import.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { TemplateImportController } from './template-import.controller.js';

function permissionOf(method: keyof TemplateImportController): string | undefined {
  const handler = TemplateImportController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

describe('permissions', () => {
  const EXPECTED: [keyof TemplateImportController, string][] = [
    ['blank', 'qc_template.view'], ['exportVersion', 'qc_template.view'],
    ['preview', 'qc_template.import'], ['commit', 'qc_template.import'],
  ];
  for (const [method, permission] of EXPECTED) {
    it(`${String(method)} requires ${permission}`, () => { expect(permissionOf(method)).toBe(permission); });
  }
});
```

Run: `pnpm --filter qc exec vitest run src/templates/template-import.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the controller and register it**

Create `apps/qc/src/templates/template-import.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, Param, PayloadTooLargeException, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ImportCommitSchema, UuidSchema, VersionNumberSchema, type TemplateCategory } from '@ipms/contracts';
import { toDocument } from './document.js';
import { EXAMPLE_DOCUMENT, buildWorkbook } from './excel/workbook.js';
import { TemplateImportService } from './template-import.service.js';
import { TemplateQueries } from './template.queries.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(reply: FastifyReply, file: Buffer, filename: string): FastifyReply {
  return reply.header('content-type', XLSX).header('content-disposition', `attachment; filename="${filename}"`).send(file);
}

@Controller('qc/templates')
export class TemplateImportController {
  constructor(private readonly imports: TemplateImportService, private readonly queries: TemplateQueries) {}

  @Get('import/blank') @RequirePermission('qc_template.view')
  async blank(@Res() reply: FastifyReply) {
    return sendXlsx(reply, await buildWorkbook({ metadata: null, version: null, document: EXAMPLE_DOCUMENT }), 'checklist-template.xlsx');
  }

  @Get(':id/versions/:version/export') @RequirePermission('qc_template.view')
  async exportVersion(@Param('id') id: string, @Param('version') version: string, @Res() reply: FastifyReply) {
    const { template, version: found } = await this.queries.getVersion(UuidSchema.parse(id), VersionNumberSchema.parse(version));
    const file = await buildWorkbook({
      metadata: { code: template.code, name: template.name, category: template.category as TemplateCategory },
      version: { version: found.version, status: found.status, publishedAt: found.publishedAt },
      document: toDocument(found),
    });
    return sendXlsx(reply, file, `${template.code}-v${found.version}.xlsx`);
  }

  @Post('import/preview') @RequirePermission('qc_template.import')
  async preview(@Req() req: FastifyRequest) {
    const file = await req.file();
    if (!file) throw new BadRequestException('Attach an .xlsx file in a "file" field');
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      throw new PayloadTooLargeException('The file is larger than 5 MB');
    }
    return this.imports.preview(buffer);
  }

  @Post('import/commit') @RequirePermission('qc_template.import')
  commit(@Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.imports.commit(ImportCommitSchema.parse(body), req.user.id);
  }
}
```

In `apps/qc/src/app.module.ts`, import `TemplateImportController` and `TemplateImportService`, put `TemplateImportController` **first** in `controllers` (before `TemplateController`, so its static `import/*` routes are registered ahead of `:id` routes), and add the provider:

```ts
    {
      provide: TemplateImportService,
      useFactory: (prisma: PrismaService, templates: TemplateService) => new TemplateImportService(prisma.db, templates),
      inject: [PrismaService, TemplateService],
    },
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter qc exec vitest run && pnpm --filter qc typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Smoke-test the Excel routes**

Rebuild qc (`docker compose -f docker/docker-compose.yml up -d --build qc`), log in as `qc` as in Task 6 Step 7, then:

```bash
curl -s -o /tmp/blank.xlsx -w '%{http_code} %{content_type}\n' localhost:3000/api/v1/qc/templates/import/blank -H "authorization: Bearer $TOKEN"
curl -s -X POST localhost:3000/api/v1/qc/templates/import/preview -H "authorization: Bearer $TOKEN" -F file=@/tmp/blank.xlsx
```

Expected: `200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; the preview returns three errors (Code, Name, Category required), because the blank workbook has no metadata.

- [ ] **Step 7: Commit**

```bash
git add apps/qc/src apps/qc/prisma/template-import.integration.spec.ts
git commit -m "feat(qc): import and export checklist templates as Excel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Internal task lookup in the project service

**Files:**
- Modify: `apps/project/src/project/project.service.ts`
- Modify: `apps/project/src/project/project.controller.ts`
- Modify: `apps/project/src/project/project.service.spec.ts`, `project.controller.spec.ts`

**Interfaces:**
- Produces: `ProjectService.internalTask(id: string): Promise<{ id: string; projectId: string; siteId: string; assigneeId: string | null; templateId: string | null; status: string }>`; route `GET /api/v1/internal/tasks/:id` requiring `task.view`. The gateway refuses `/internal/`; qc calls project directly.

- [ ] **Step 1: Write the failing tests**

Append to `apps/project/src/project/project.service.spec.ts`:

```ts
describe('internalTask', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('returns only what qc needs to authorize a checklist request', async () => {
    const task = { id: 't-1', projectId: 'p-1', siteId: 's-1', assigneeId: 'u-1', templateId: 'tpl-1', status: 'ONGOING' };
    prisma.task.findUnique.mockResolvedValue(task);
    await expect(service(prisma).internalTask('t-1')).resolves.toEqual(task);
    expect(prisma.task.findUnique).toHaveBeenCalledWith({
      where: { id: 't-1' },
      select: { id: true, projectId: true, siteId: true, assigneeId: true, templateId: true, status: true },
    });
  });

  it('refuses a task that does not exist', async () => {
    prisma.task.findUnique.mockResolvedValue(null);
    await expect(service(prisma).internalTask('t-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

In `apps/project/src/project/project.controller.spec.ts`, add `['internalTask', 'task.view'],` to the `EXPECTED` array.

Run: `pnpm --filter project exec vitest run src/project`
Expected: FAIL — `internalTask` is not a function / permission undefined.

- [ ] **Step 2: Implement**

In `apps/project/src/project/project.service.ts`, add this method directly after `siteGeofence`:

```ts
  async internalTask(id: string): Promise<{ id: string; projectId: string; siteId: string; assigneeId: string | null; templateId: string | null; status: string }> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, projectId: true, siteId: true, assigneeId: true, templateId: true, status: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
```

In `apps/project/src/project/project.controller.ts`, add this route on the line after the `internal/sites/:id/geofence` route:

```ts
  @Get('internal/tasks/:id') @RequirePermission('task.view') internalTask(@Param('id') id:string){ return this.service.internalTask(UuidSchema.parse(id)); }
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter project exec vitest run src/project && pnpm --filter project typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add apps/project/src/project
git commit -m "feat(project): expose an internal task lookup for qc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The task checklist endpoint

**Files:**
- Create: `apps/qc/src/tasks/task-lookup.client.ts`, `task-lookup.client.spec.ts`
- Create: `apps/qc/src/tasks/task-checklist.controller.ts`, `task-checklist.controller.spec.ts`
- Modify: `apps/qc/src/app.module.ts`

**Interfaces:**
- Consumes: `GET /api/v1/internal/tasks/:id` (Task 9); `TemplateQueries.currentTree` (Task 5).
- Produces: `TaskLookupClient.fetch(taskId: string, bearer: string): Promise<TaskLookup>` where `TaskLookup = { state: 'found'; task: TaskRef } | { state: 'not_found' } | { state: 'forbidden' } | { state: 'unavailable' }` and `TaskRef = { id; projectId; siteId; assigneeId: string | null; templateId: string | null; status }`; route `GET /api/v1/qc/tasks/:taskId/checklist` returning `{ task: { id, projectId, siteId }, template, version }`.

- [ ] **Step 1: Write the failing client test**

Create `apps/qc/src/tasks/task-lookup.client.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskLookupClient } from './task-lookup.client.js';

afterEach(() => { vi.unstubAllGlobals(); });

const client = new TaskLookupClient('http://project:3004');
const TASK = { id: 't-1', projectId: 'p-1', siteId: 's-1', assigneeId: 'u-1', templateId: 'tpl-1', status: 'ONGOING' };

describe('TaskLookupClient.fetch', () => {
  it('forwards the caller’s bearer token to the internal endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(TASK), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client.fetch('t-1', 'Bearer t')).resolves.toEqual({ state: 'found', task: TASK });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://project:3004/api/v1/internal/tasks/t-1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it.each([[404, 'not_found'], [403, 'forbidden'], [401, 'forbidden'], [500, 'unavailable']])('maps %i to %s', async (status, state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(client.fetch('t-1', 'Bearer t')).resolves.toEqual({ state });
  });

  it('is unavailable when the service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(client.fetch('t-1', 'Bearer t')).resolves.toEqual({ state: 'unavailable' });
  });
});
```

Run: `pnpm --filter qc exec vitest run src/tasks`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the client**

Create `apps/qc/src/tasks/task-lookup.client.ts`:

```ts
export interface TaskRef {
  id: string; projectId: string; siteId: string;
  assigneeId: string | null; templateId: string | null; status: string;
}

export type TaskLookup =
  | { state: 'found'; task: TaskRef }
  | { state: 'not_found' }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

/**
 * Forwards the caller's own bearer token, so project checks their permission
 * and no shared service secret is needed. Unlike the geofence lookup, a failure
 * cannot degrade gracefully: without the task there is no authorization decision.
 */
export class TaskLookupClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  async fetch(taskId: string, bearer: string): Promise<TaskLookup> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}/api/v1/internal/tasks/${taskId}`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) return { state: 'not_found' };
      if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
      if (!response.ok) return { state: 'unavailable' };
      return { state: 'found', task: (await response.json()) as TaskRef };
    } catch {
      return { state: 'unavailable' };
    }
  }
}
```

- [ ] **Step 3: Write the failing controller test**

Create `apps/qc/src/tasks/task-checklist.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { TaskChecklistController } from './task-checklist.controller.js';
import type { TaskLookup, TaskLookupClient } from './task-lookup.client.js';
import type { TemplateQueries } from '../templates/template.queries.js';

const TASK_ID = '0192f7a0-0000-7000-8000-000000000001';
const ENGINEER = { id: 'u-engineer', permissions: ['task.view'] };
const MANAGER = { id: 'u-manager', permissions: ['qc_template.view'] };
const TASK = { id: TASK_ID, projectId: 'p-1', siteId: 's-1', assigneeId: 'u-engineer', templateId: 'tpl-1', status: 'ONGOING' };
const TEMPLATE = { id: 'tpl-1', code: 'AI-RRU', disabledAt: null as Date | null };
const VERSION = { id: 'v-1', version: 2, sections: [] };

function setup(lookup: TaskLookup, tree: unknown = { template: TEMPLATE, version: VERSION }) {
  const tasks = { fetch: vi.fn().mockResolvedValue(lookup) };
  const queries = { currentTree: vi.fn().mockResolvedValue(tree) };
  const controller = new TaskChecklistController(tasks as unknown as TaskLookupClient, queries as unknown as TemplateQueries);
  const call = (user: { id: string; permissions: string[] }) => controller.checklist(TASK_ID, { user, headers: { authorization: 'Bearer t' } } as never);
  return { tasks, queries, call };
}

describe('GET /qc/tasks/:taskId/checklist', () => {
  it('gives the assignee the current published version', async () => {
    const { call, tasks } = setup({ state: 'found', task: TASK });
    await expect(call(ENGINEER)).resolves.toEqual({ task: { id: TASK_ID, projectId: 'p-1', siteId: 's-1' }, template: TEMPLATE, version: VERSION });
    expect(tasks.fetch).toHaveBeenCalledWith(TASK_ID, 'Bearer t');
  });

  it('lets a holder of qc_template.view preview it', async () => {
    const { call } = setup({ state: 'found', task: TASK });
    await expect(call(MANAGER)).resolves.toMatchObject({ version: VERSION });
  });

  it('refuses anyone else', async () => {
    const { call } = setup({ state: 'found', task: TASK });
    await expect(call({ id: 'u-other', permissions: ['task.view'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 404 for a task without a checklist', async () => {
    const { call } = setup({ state: 'found', task: { ...TASK, templateId: null } });
    await expect(call(ENGINEER)).rejects.toThrow('This task has no checklist assigned');
  });

  it('answers 409 for a disabled template', async () => {
    const { call } = setup({ state: 'found', task: TASK }, { template: { ...TEMPLATE, disabledAt: new Date() }, version: VERSION });
    await expect(call(ENGINEER)).rejects.toThrow('This checklist has been disabled');
  });

  it('answers 409 for a template never published', async () => {
    const { call } = setup({ state: 'found', task: TASK }, { template: TEMPLATE, version: null });
    await expect(call(ENGINEER)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    [{ state: 'not_found' } as const, NotFoundException],
    [{ state: 'forbidden' } as const, ForbiddenException],
    [{ state: 'unavailable' } as const, ServiceUnavailableException],
  ])('passes the project answer %o through', async (lookup, type) => {
    const { call } = setup(lookup);
    await expect(call(ENGINEER)).rejects.toBeInstanceOf(type);
  });
});
```

Run: `pnpm --filter qc exec vitest run src/tasks`
Expected: FAIL — `task-checklist.controller.js` not found.

- [ ] **Step 4: Implement the controller and register it**

Create `apps/qc/src/tasks/task-checklist.controller.ts`:

```ts
import {
  ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Req, ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthzUser } from '@ipms/authz';
import { UuidSchema } from '@ipms/contracts';
import { TemplateQueries } from '../templates/template.queries.js';
import { TaskLookupClient, type TaskLookup, type TaskRef } from './task-lookup.client.js';

function requireTask(lookup: TaskLookup): TaskRef {
  switch (lookup.state) {
    case 'found': return lookup.task;
    case 'not_found': throw new NotFoundException('Task not found');
    case 'forbidden': throw new ForbiddenException('You cannot view this task');
    case 'unavailable': throw new ServiceUnavailableException('The project service could not be reached. Try again shortly.');
  }
}

/** Carries no @RequirePermission: access follows task assignment, which only project knows. */
@Controller('qc/tasks')
export class TaskChecklistController {
  constructor(private readonly tasks: TaskLookupClient, private readonly queries: TemplateQueries) {}

  @Get(':taskId/checklist')
  async checklist(@Param('taskId') taskId: string, @Req() req: { user: AuthzUser; headers: Record<string, string | undefined> }) {
    const id = UuidSchema.parse(taskId);
    const task = requireTask(await this.tasks.fetch(id, req.headers['authorization'] ?? ''));
    if (task.assigneeId !== req.user.id && !req.user.permissions.includes('qc_template.view')) {
      throw new ForbiddenException('This task is not assigned to you');
    }
    if (!task.templateId) throw new NotFoundException('This task has no checklist assigned');
    const current = await this.queries.currentTree(task.templateId);
    if (!current) throw new NotFoundException('The checklist assigned to this task no longer exists');
    if (current.template.disabledAt) throw new ConflictException('This checklist has been disabled');
    if (!current.version) throw new ConflictException('This checklist has not been published yet');
    return { task: { id: task.id, projectId: task.projectId, siteId: task.siteId }, template: current.template, version: current.version };
  }
}
```

In `apps/qc/src/app.module.ts`: import both new classes; add `TaskChecklistController` to `controllers`; add the provider:

```ts
    { provide: TaskLookupClient, useFactory: () => new TaskLookupClient(projectInternalUrl()) },
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter qc exec vitest run && pnpm --filter qc typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/qc/src/tasks apps/qc/src/app.module.ts
git commit -m "feat(qc): serve a task's checklist to its assignee

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: QC permissions in the IAM seed

**Files:**
- Modify: `apps/iam/prisma/seed.ts`
- Modify: `apps/iam/prisma/seed.integration.spec.ts`

**Interfaces:**
- Produces: after seeding, `PROJECT_MANAGER` holds `qc_template.view` but no `qc_template.create|update|publish|import`; `FIELD_ENGINEER` holds no `qc_template.*`.

- [ ] **Step 1: Write the failing assertions**

Append inside the `describe('seedIam', …)` block of `apps/iam/prisma/seed.integration.spec.ts`:

```ts
  it('leaves the template library to QC managers: project managers may only view it', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'PROJECT_MANAGER' }, include: { permissions: { include: { permission: true } } },
    });
    const codes = role.permissions.map((rp) => rp.permission.code);
    expect(codes).toContain('qc_template.view');
    for (const code of ['qc_template.create', 'qc_template.update', 'qc_template.publish', 'qc_template.import']) {
      expect(codes).not.toContain(code);
    }
  });

  it('keeps field engineers out of the template library', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'FIELD_ENGINEER' }, include: { permissions: { include: { permission: true } } },
    });
    expect(role.permissions.map((rp) => rp.permission.code).filter((code) => code.startsWith('qc_template.'))).toEqual([]);
  });
```

Run: `pnpm --filter iam exec vitest run prisma/seed.integration.spec.ts`
Expected: FAIL on both new tests.

- [ ] **Step 2: Change the seed**

In `apps/iam/prisma/seed.ts`:
- In the `PROJECT_MANAGER` permissions, replace the line
  `'qc_template.view', 'qc_template.create', 'qc_template.update', 'qc_template.publish', 'qc_template.import',`
  with
  `'qc_template.view',`
- In the `FIELD_ENGINEER` permissions, replace
  `'qc_template.view', 'qc_submission.view', 'qc_submission.create',`
  with
  `'qc_submission.view', 'qc_submission.create',`

Leave `QC_MANAGER` unchanged. The seed deletes and rewrites each system role's permissions on every run, so existing databases converge on the next `pnpm --filter iam seed`.

- [ ] **Step 3: Run the IAM tests**

Run: `pnpm --filter iam exec vitest run`
Expected: all PASS. If another IAM test asserts the old Project Manager or Field Engineer permission list, update that assertion to the new list — the seed is the source of truth for this change.

- [ ] **Step 4: Commit**

```bash
git add apps/iam/prisma/seed.ts apps/iam/prisma/seed.integration.spec.ts
git commit -m "feat(iam): leave template authoring to QC managers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Web API layer — validation details, QC client, Excel downloads

**Files:**
- Modify: `apps/web/app/lib/api-client.ts`, `apps/web/app/lib/api-client.spec.ts`
- Rewrite: `apps/web/app/lib/qc-api.ts`, `apps/web/app/lib/qc-api.spec.ts`
- Create: `apps/web/app/lib/download.ts`, `apps/web/app/lib/download.spec.ts`
- Create: `apps/web/app/api/qc/templates/blank/route.ts`
- Create: `apps/web/app/api/qc/templates/[id]/versions/[version]/export/route.ts`

**Interfaces:**
- Consumes: the qc routes from Tasks 6, 8, 10.
- Produces:
  - `ApiResult`'s `unavailable` variant gains `details?: Record<string, string>` (string-valued entries of the error envelope's `details`).
  - `qc-api.ts` types: `TemplateCategory`, `ResponseType`, `Severity`, `TemplateTab`, `VersionStatus`, `ChecklistTemplate`, `TemplateListEntry`, `VersionSummary`, `TemplateDetail`, `ChecklistItem`, `ChecklistSection`, `VersionDetail`, `DraftSummary`, `CreatedDraft`, `SaveDraftBody`, `ListTemplatesParams`, plus the existing submission types.
  - `qc-api.ts` functions: `listTemplates(params)`, `getTemplate(id)`, `getVersion(id, version)`, `createTemplate(dto)`, `updateTemplate(id, dto)`, `startDraft(id)`, `saveDraft(id, body)`, `discardDraft(id)`, `publishTemplate(id)`, `disableTemplate(id)`, `enableTemplate(id)`, `previewTemplateImport(file)`, `commitTemplateImport(dto)`, `getSubmission(id)`, `createSubmission(dto)`, `reviewSubmission(id, dto)`.
  - `proxyDownload(path: string, fallbackFilename: string, forbiddenMessage: string): Promise<NextResponse>`.
  - Browser download URLs `/api/qc/templates/blank` and `/api/qc/templates/:id/versions/:version/export`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/app/lib/api-client.spec.ts`:

```ts
describe('authFetch — validation details', () => {
  it('keeps the string-valued details of a validation failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, {
      error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', correlationId: 'c-1', details: { 'sections.0.title': 'Required', odd: 5 } },
    })));
    const result = await authFetch('/api/v1/qc/templates/t/draft');
    expect(result).toMatchObject({ state: 'unavailable', status: 422, details: { 'sections.0.title': 'Required' } });
    expect((result as { details: Record<string, unknown> }).details).not.toHaveProperty('odd');
  });
});
```

Replace `apps/web/app/lib/qc-api.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const api = await import('./qc-api');

beforeEach(() => { authFetch.mockClear(); });

describe('qc-api — every call maps to a gateway route', () => {
  it('lists a tab, dropping empty filters', async () => {
    await api.listTemplates({ tab: 'draft', category: undefined, q: undefined });
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/templates', { query: { tab: 'draft', category: undefined, q: undefined } }]);
  });

  it('reads a template and a version', async () => {
    await api.getTemplate('t-1');
    await api.getVersion('t-1', 3);
    expect(authFetch.mock.calls.map((call) => call[0])).toEqual(['/api/v1/qc/templates/t-1', '/api/v1/qc/templates/t-1/versions/3']);
  });

  it('creates and renames', async () => {
    await api.createTemplate({ code: 'A', name: 'A', category: 'EHS' });
    await api.updateTemplate('t-1', { name: 'B' });
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/templates', { method: 'POST', json: { code: 'A', name: 'A', category: 'EHS' } }]);
    expect(authFetch.mock.calls[1]).toEqual(['/api/v1/qc/templates/t-1', { method: 'PATCH', json: { name: 'B' } }]);
  });

  it('drives the draft lifecycle', async () => {
    const body = { revision: 2, document: { sections: [] } };
    await api.startDraft('t-1');
    await api.saveDraft('t-1', body);
    await api.discardDraft('t-1');
    await api.publishTemplate('t-1');
    await api.disableTemplate('t-1');
    await api.enableTemplate('t-1');
    expect(authFetch.mock.calls).toEqual([
      ['/api/v1/qc/templates/t-1/draft', { method: 'POST' }],
      ['/api/v1/qc/templates/t-1/draft', { method: 'PUT', json: body }],
      ['/api/v1/qc/templates/t-1/draft', { method: 'DELETE' }],
      ['/api/v1/qc/templates/t-1/publish', { method: 'POST' }],
      ['/api/v1/qc/templates/t-1/disable', { method: 'POST' }],
      ['/api/v1/qc/templates/t-1/enable', { method: 'POST' }],
    ]);
  });

  it('uploads an import as multipart and commits it as JSON', async () => {
    const file = new File(['x'], 'checklist.xlsx');
    await api.previewTemplateImport(file);
    const [path, request] = authFetch.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(path).toBe('/api/v1/qc/templates/import/preview');
    expect(request.method).toBe('POST');
    expect(request.body.get('file')).toBeInstanceOf(File);
    const dto = { code: 'A', name: 'A', category: 'QUALITY' as const, document: { sections: [] } };
    await api.commitTemplateImport(dto);
    expect(authFetch.mock.calls[1]).toEqual(['/api/v1/qc/templates/import/commit', { method: 'POST', json: dto }]);
  });

  it('keeps the submission calls', async () => {
    await api.getSubmission('s-1');
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/qc/submissions/s-1']);
  });
});
```

Create `apps/web/app/lib/download.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const { proxyDownload } = await import('./download');

beforeEach(() => { cookieStore.get.mockReset(); vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('proxyDownload', () => {
  it('answers 401 without a session and never calls the gateway', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxyDownload('/api/v1/qc/templates/import/blank', 'x.xlsx', 'nope');
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams the file with the upstream filename', async () => {
    cookieStore.get.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', {
      status: 200, headers: { 'content-disposition': 'attachment; filename="AI-v2.xlsx"' },
    })));
    const response = await proxyDownload('/api/v1/qc/templates/t/versions/2/export', 'x.xlsx', 'nope');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="AI-v2.xlsx"');
    expect(await response.text()).toBe('bytes');
  });

  it('keeps a 403 a 403, with the given message', async () => {
    cookieStore.get.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const response = await proxyDownload('/api/v1/x', 'x.xlsx', 'You cannot view templates.');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: 'You cannot view templates.' });
  });
});
```

Run: `pnpm --filter web exec vitest run app/lib`
Expected: FAIL — missing `details`, missing `listTemplates` signature, missing `./download`.

- [ ] **Step 2: Keep validation details in `api-client.ts`**

In `apps/web/app/lib/api-client.ts`:

1. Change the `unavailable` member of `ApiResult` to:

```ts
  | { state: 'unavailable'; status: number | null; message: string; code?: ErrorCode; correlationId?: string; details?: Record<string, string> };
```

2. Replace `describeFailure` with:

```ts
async function describeFailure(response: Response): Promise<{ message: string; code?: ErrorCode; correlationId?: string; details?: Record<string, string> }> {
  try {
    const payload: unknown = await response.json();
    const envelope = (payload as { error?: Record<string, unknown> } | null)?.error;
    if (envelope && typeof envelope['message'] === 'string' && envelope['message'].length > 0) {
      const rawDetails = envelope['details'];
      // Only strings survive: a field path mapped to its message is all a form can render.
      const details = rawDetails && typeof rawDetails === 'object'
        ? Object.fromEntries(Object.entries(rawDetails as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : undefined;
      return {
        message: envelope['message'],
        ...(typeof envelope['code'] === 'string' ? { code: envelope['code'] as ErrorCode } : {}),
        ...(typeof envelope['correlationId'] === 'string' ? { correlationId: envelope['correlationId'] } : {}),
        ...(details && Object.keys(details).length > 0 ? { details } : {}),
      };
    }
  } catch {
    // Not JSON, or not the envelope — fall through to the generic message.
  }
  return { message: UNEXPECTED };
}
```

The 403 branch in `authFetch` destructures only `message` and `correlationId`, so it is unaffected.

- [ ] **Step 3: Rewrite `qc-api.ts`**

Replace `apps/web/app/lib/qc-api.ts`:

```ts
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
```

- [ ] **Step 4: Write the download helper and routes**

Create `apps/web/app/lib/download.ts`:

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, apiBaseUrl } from './session';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Streams a file from the gateway to the browser on this origin. The session
 * is an http-only cookie scoped here, so a link straight at the gateway would
 * arrive unauthenticated; this reads the cookie server-side and pipes the bytes.
 */
export async function proxyDownload(path: string, fallbackFilename: string, forbiddenMessage: string): Promise<NextResponse> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Sign in to download this file.' }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    return NextResponse.json({ message: 'The iPMS API could not be reached.' }, { status: 503 });
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { message: upstream.status === 403 ? forbiddenMessage : 'The file could not be generated.' },
      { status: upstream.status },
    );
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? XLSX,
      'content-disposition': upstream.headers.get('content-disposition') ?? `attachment; filename="${fallbackFilename}"`,
      'cache-control': 'no-store',
    },
  }) as NextResponse;
}
```

Create `apps/web/app/api/qc/templates/blank/route.ts`:

```ts
import type { NextResponse } from 'next/server';
import { proxyDownload } from '../../../../lib/download';

export async function GET(): Promise<NextResponse> {
  return proxyDownload('/api/v1/qc/templates/import/blank', 'checklist-template.xlsx', 'You do not have permission to view checklist templates.');
}
```

Create `apps/web/app/api/qc/templates/[id]/versions/[version]/export/route.ts`:

```ts
import type { NextResponse } from 'next/server';
import { proxyDownload } from '../../../../../../../lib/download';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
): Promise<NextResponse> {
  const { id, version } = await params;
  return proxyDownload(
    `/api/v1/qc/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/export`,
    'checklist.xlsx',
    'You do not have permission to view checklist templates.',
  );
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter web exec vitest run app/lib && pnpm --filter web typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib apps/web/app/api/qc
git commit -m "feat(web): add the checklist template API client and Excel downloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Template list, create, detail and version screens

**Files:**
- Modify: `apps/web/app/shell.tsx`, `apps/web/app/shell.spec.tsx`, `apps/web/app/styles.css`
- Create: `apps/web/app/quality/templates/labels.ts`
- Create: `apps/web/app/quality/templates/actions.ts`, `actions.spec.ts`
- Create: `apps/web/app/quality/templates/forms.tsx`
- Create: `apps/web/app/quality/templates/version-view.tsx`
- Create: `apps/web/app/quality/templates/page.tsx`
- Create: `apps/web/app/quality/templates/new/page.tsx`
- Create: `apps/web/app/quality/templates/[id]/page.tsx`
- Create: `apps/web/app/quality/templates/[id]/versions/[version]/page.tsx`

**Interfaces:**
- Consumes: `qc-api.ts` (Task 12); `settle`, `optional` (`app/lib/settle.ts`); `FormState`, `EMPTY`; `SubmitButton`, `FormError`, `RowAction` from `app/projects/forms.tsx`; `getCurrentUser`, `hasPermission`; `Sidebar`, `StatePage`, `TopActions`.
- Produces: server actions `createTemplateAction`, `renameTemplateAction`, `startDraftAction`, `disableTemplateAction`, `enableTemplateAction` (all `(state: FormState, form: FormData) => Promise<FormState>`, reading `templateId` from the form where relevant); `labels.ts` exports `CATEGORY_LABELS`, `CATEGORIES`, `RESPONSE_TYPE_LABELS`, `RESPONSE_TYPES`, `TABS`, `photoLabel(min, max)`, `formatDate(iso)`; `VersionView({ sections })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/quality/templates/actions.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); });
vi.mock('next/navigation', () => ({ redirect }));

const qc = { createTemplate: vi.fn(), updateTemplate: vi.fn(), startDraft: vi.fn(), disableTemplate: vi.fn(), enableTemplate: vi.fn() };
vi.mock('../../lib/qc-api', () => qc);

const actions = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('createTemplateAction', () => {
  it('upper-cases the code and opens the new draft', async () => {
    qc.createTemplate.mockResolvedValue({ state: 'ready', data: { templateId: ID, draft: {} } });
    await expect(actions.createTemplateAction({}, form({ code: 'ai-rru', name: 'Antenna', category: 'QUALITY' })))
      .rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}/draft`);
    expect(qc.createTemplate).toHaveBeenCalledWith({ code: 'AI-RRU', name: 'Antenna', category: 'QUALITY' });
  });

  it('asks for every field before calling the API', async () => {
    expect((await actions.createTemplateAction({}, form({ code: 'A', name: '' , category: 'QUALITY' }))).error).toContain('required');
    expect(qc.createTemplate).not.toHaveBeenCalled();
  });

  it('shows the service message on a conflict', async () => {
    qc.createTemplate.mockResolvedValue({ state: 'unavailable', status: 409, message: 'A template with code A already exists' });
    expect((await actions.createTemplateAction({}, form({ code: 'A', name: 'A', category: 'EHS' }))).error).toBe('A template with code A already exists');
  });
});

describe('renameTemplateAction', () => {
  it('sends only the fields given', async () => {
    qc.updateTemplate.mockResolvedValue({ state: 'ready', data: {} });
    expect(await actions.renameTemplateAction({}, form({ templateId: ID, name: 'New name' }))).toEqual({});
    expect(qc.updateTemplate).toHaveBeenCalledWith(ID, { name: 'New name' });
  });
});

describe('startDraftAction', () => {
  it('opens the new draft', async () => {
    qc.startDraft.mockResolvedValue({ state: 'ready', data: { templateId: ID, draft: {} } });
    await expect(actions.startDraftAction({}, form({ templateId: ID }))).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}/draft`);
  });
});

describe('disable and enable', () => {
  it('report the service message', async () => {
    qc.disableTemplate.mockResolvedValue({ state: 'unavailable', status: 409, message: 'Only a published template can be disabled' });
    expect((await actions.disableTemplateAction({}, form({ templateId: ID }))).error).toBe('Only a published template can be disabled');
    qc.enableTemplate.mockResolvedValue({ state: 'ready', data: {} });
    expect(await actions.enableTemplateAction({}, form({ templateId: ID }))).toEqual({});
  });
});
```

In `apps/web/app/shell.spec.tsx`, append inside `describe('Sidebar', …)`:

```ts
  it('offers Quality & EHS to a viewer who may see templates, and hides it otherwise', async () => {
    getCurrentUser.mockResolvedValue(user(['qc_template.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).toContain('/quality/templates');
    getCurrentUser.mockResolvedValue(user(['project.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/quality/templates');
  });
```

Run: `pnpm --filter web exec vitest run app/quality app/shell.spec.tsx`
Expected: FAIL — `./actions` not found; the sidebar still links `/#quality`.

- [ ] **Step 2: Labels and actions**

Create `apps/web/app/quality/templates/labels.ts`:

```ts
import type { ResponseType, TemplateCategory, TemplateTab } from '../../lib/qc-api';

export const CATEGORY_LABELS: Record<TemplateCategory, string> = { QUALITY: 'Quality', EHS: 'EHS', OTHER: 'Other' };
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as TemplateCategory[];

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  RESULT_ONLY: 'Result only', TEXT: 'Text', NUMBER: 'Number', BOOLEAN: 'Yes/No', SELECT: 'Select',
};
export const RESPONSE_TYPES = Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[];

export const TABS: readonly { key: TemplateTab; label: string }[] = [
  { key: 'enabled', label: 'Enabled' }, { key: 'draft', label: 'Draft Box' }, { key: 'disabled', label: 'Disabled' },
];

const plural = (n: number): string => `${n} photo${n === 1 ? '' : 's'}`;

export function photoLabel(min: number, max: number): string | null {
  if (max === 0) return null;
  if (min === 0) return `Optional, up to ${plural(max)}`;
  return min === max ? plural(min) : `${min}–${max} photos`;
}

export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
```

Create `apps/web/app/quality/templates/actions.ts`:

```ts
'use server';
import { redirect } from 'next/navigation';
import { createTemplate, disableTemplate, enableTemplate, startDraft, updateTemplate, type TemplateCategory } from '../../lib/qc-api';
import type { FormState } from '../../lib/form-state';
import { optional, settle } from '../../lib/settle';

const CATEGORIES: readonly TemplateCategory[] = ['QUALITY', 'EHS', 'OTHER'];
const LIST = '/quality/templates';
const detail = (id: string): string => `${LIST}/${id}`;

function readCategory(form: FormData): TemplateCategory | undefined {
  const value = form.get('category');
  return CATEGORIES.find((category) => category === value);
}

export async function createTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const code = optional(form, 'code')?.toUpperCase();
  const name = optional(form, 'name');
  const category = readCategory(form);
  if (!code || !name || !category) return { error: 'Code, name and category are required.' };
  const result = await createTemplate({ code, name, category });
  const state = await settle(result, LIST);
  if (state.error) return state;
  if (result.state === 'ready') redirect(`${detail(result.data.templateId)}/draft`);
  return state;
}

export async function renameTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  const name = optional(form, 'name');
  const category = readCategory(form);
  if (!name && !category) return { error: 'Enter a new name or pick a category.' };
  const result = await updateTemplate(id, { ...(name ? { name } : {}), ...(category ? { category } : {}) });
  return settle(result, [LIST, detail(id)]);
}

export async function startDraftAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  const result = await startDraft(id);
  const state = await settle(result, [LIST, detail(id)]);
  if (state.error) return state;
  redirect(`${detail(id)}/draft`);
}

export async function disableTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  return settle(await disableTemplate(id), [LIST, detail(id)]);
}

export async function enableTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  return settle(await enableTemplate(id), [LIST, detail(id)]);
}
```

- [ ] **Step 3: Navigation**

In `apps/web/app/shell.tsx`, inside `Sidebar`, add below `mayViewUsers`:

```ts
  const mayViewTemplates = viewer.state === 'ready' && hasPermission(viewer.data, 'qc_template.view');
```

and replace the Quality nav line with:

```tsx
        {mayViewTemplates ? <NavItem section="quality" active={active} href="/quality/templates" icon="✓">Quality &amp; EHS</NavItem> : null}
```

Run: `pnpm --filter web exec vitest run app/quality app/shell.spec.tsx`
Expected: PASS.

- [ ] **Step 4: Client forms**

Create `apps/web/app/quality/templates/forms.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { EMPTY } from '../../lib/form-state';
import { FormError, SubmitButton } from '../../projects/forms';
import { createTemplateAction, renameTemplateAction } from './actions';
import { CATEGORIES, CATEGORY_LABELS } from './labels';
import type { TemplateCategory } from '../../lib/qc-api';

export function CreateTemplateForm() {
  const [state, action] = useActionState(createTemplateAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <div className="form-grid">
        <label className="field">Code
          <input name="code" required maxLength={50} pattern="[A-Za-z0-9_\-]+" />
          <span className="hint">Letters, digits, dash or underscore. Stored in upper case and cannot be changed later.</span>
        </label>
        <label className="field">Name<input name="name" required maxLength={250} /></label>
        <label className="field">Category
          <select name="category" defaultValue="QUALITY">
            {CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
          </select>
        </label>
      </div>
      <FormError state={state} />
      <SubmitButton>Create and open draft</SubmitButton>
    </form>
  );
}

export function RenameTemplateForm({ templateId, name, category }: { templateId: string; name: string; category: TemplateCategory }) {
  const [state, action] = useActionState(renameTemplateAction, EMPTY);
  return (
    <details className="inline-details">
      <summary className="ghost-button">Rename</summary>
      <form action={action} className="panel-form">
        <input type="hidden" name="templateId" value={templateId} />
        <div className="form-grid">
          <label className="field">Name<input name="name" defaultValue={name} maxLength={250} /></label>
          <label className="field">Category
            <select name="category" defaultValue={category}>
              {CATEGORIES.map((option) => <option key={option} value={option}>{CATEGORY_LABELS[option]}</option>)}
            </select>
          </label>
        </div>
        <FormError state={state} />
        <SubmitButton>Save</SubmitButton>
      </form>
    </details>
  );
}
```

- [ ] **Step 5: The read-only version view**

Create `apps/web/app/quality/templates/version-view.tsx`:

```tsx
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
```

- [ ] **Step 6: The list page**

Create `apps/web/app/quality/templates/page.tsx`:

```tsx
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listTemplates, type TemplateCategory, type TemplateTab } from '../../lib/qc-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { CATEGORIES, CATEGORY_LABELS, TABS, formatDate } from './labels';

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ tab?: string; category?: string; q?: string }> }) {
  const params = await searchParams;
  const tab: TemplateTab = TABS.find((entry) => entry.key === params.tab)?.key ?? 'enabled';
  const category: TemplateCategory | undefined = CATEGORIES.find((entry) => entry === params.category);
  const q = params.q?.trim() || undefined;

  const [templates, viewer] = await Promise.all([listTemplates({ tab, category, q }), getCurrentUser()]);
  if (templates.state === 'unauthenticated') {
    return <StatePage title="Sign in to view checklist templates"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (templates.state === 'forbidden') {
    return <StatePage title="Your account cannot view checklist templates"><p>{templates.message}</p></StatePage>;
  }
  if (templates.state === 'unavailable') {
    return (
      <StatePage title="Checklist templates are not available">
        <p>{templates.message}</p>
        {templates.correlationId ? <p className="subtle">Correlation ID: <code>{templates.correlationId}</code></p> : null}
      </StatePage>
    );
  }

  const may = (permission: string): boolean => viewer.state === 'ready' && hasPermission(viewer.data, permission);
  const tabHref = (target: TemplateTab): string => {
    const query = new URLSearchParams({ tab: target });
    if (category) query.set('category', category);
    if (q) query.set('q', q);
    return `/quality/templates?${query.toString()}`;
  };

  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><span>Quality &amp; EHS</span><b>/</b><strong>Templates</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">QUALITY &amp; EHS</p><h1>Checklist templates</h1></div>
            <div className="toolbar-actions">
              <a className="ghost-button" href="/api/qc/templates/blank">Download blank workbook</a>
              {may('qc_template.import') ? <a className="ghost-button" href="/quality/templates/import">Import from Excel</a> : null}
              {may('qc_template.create') ? <a className="primary-button" href="/quality/templates/new">New template</a> : null}
            </div>
          </div>
          <section className="panel">
            <nav className="tab-row" aria-label="Template status">
              {TABS.map((entry) => (
                <a key={entry.key} href={tabHref(entry.key)} aria-current={entry.key === tab ? 'true' : undefined}>{entry.label}</a>
              ))}
            </nav>
            <form className="inline-form" method="get" action="/quality/templates">
              <input type="hidden" name="tab" value={tab} />
              <input name="q" defaultValue={q ?? ''} placeholder="Search code or name" aria-label="Search code or name" maxLength={100} />
              <select name="category" defaultValue={category ?? ''} aria-label="Category">
                <option value="">All categories</option>
                {CATEGORIES.map((entry) => <option key={entry} value={entry}>{CATEGORY_LABELS[entry]}</option>)}
              </select>
              <button className="ghost-button" type="submit">Filter</button>
            </form>
            {templates.data.length === 0 ? (
              <p className="empty-list">No templates here yet.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th><th>Name</th><th>Category</th>
                    {tab === 'draft' ? <><th>Draft</th><th>Last saved</th></> : <><th>Version</th><th>Items</th><th>Last published</th></>}
                  </tr>
                </thead>
                <tbody>
                  {templates.data.map((template) => (
                    <tr key={template.id}>
                      <td><a href={`/quality/templates/${template.id}`}><strong>{template.code}</strong></a></td>
                      <td>{template.name}</td>
                      <td>{CATEGORY_LABELS[template.category]}</td>
                      {tab === 'draft' ? (
                        <>
                          <td><a href={`/quality/templates/${template.id}/draft`}>v{template.draft?.version}</a>{template.draft?.source === 'EXCEL_IMPORT' ? <span className="badge slate">Excel</span> : null}</td>
                          <td>{formatDate(template.draft?.updatedAt ?? null)}</td>
                        </>
                      ) : (
                        <>
                          <td>{template.current ? `v${template.current.version}` : '—'}{template.draft ? <span className="badge amber">Draft v{template.draft.version}</span> : null}</td>
                          <td>{template.current ? <>{template.current.itemCount}{template.current.criticalCount ? <span className="subtle"> ({template.current.criticalCount} critical)</span> : null}</> : '—'}</td>
                          <td>{formatDate(template.current?.publishedAt ?? null)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: The create page**

Create `apps/web/app/quality/templates/new/page.tsx`:

```tsx
import { Sidebar, TopActions } from '../../../shell';
import { CreateTemplateForm } from '../forms';

export default function NewTemplatePage() {
  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><strong>New template</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header"><div><h2>New checklist template</h2><p>Templates are shared by every project. You will add sections and items in the draft editor next.</p></div></div>
            <CreateTemplateForm />
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 8: The detail page**

Create `apps/web/app/quality/templates/[id]/page.tsx`:

```tsx
import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getTemplate, getVersion } from '../../../lib/qc-api';
import { RowAction } from '../../../projects/forms';
import { Sidebar, StatePage, TopActions } from '../../../shell';
import { disableTemplateAction, enableTemplateAction, startDraftAction } from '../actions';
import { RenameTemplateForm } from '../forms';
import { CATEGORY_LABELS, formatDate } from '../labels';
import { VersionView } from '../version-view';

const STATUS_BADGE = { DRAFT: 'amber', PUBLISHED: 'green', RETIRED: 'slate' } as const;

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, viewer] = await Promise.all([getTemplate(id), getCurrentUser()]);
  if (detail.state === 'unauthenticated') {
    return <StatePage title="Sign in to view this template"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (detail.state !== 'ready') {
    return <StatePage title="This template is not available"><p>{detail.message}</p><a href="/quality/templates">Back to templates</a></StatePage>;
  }
  const template = detail.data;
  const published = template.versions.find((version) => version.status === 'PUBLISHED');
  const draft = template.versions.find((version) => version.status === 'DRAFT');
  const current = published ? await getVersion(id, published.version) : null;
  const may = (permission: string): boolean => viewer.state === 'ready' && hasPermission(viewer.data, permission);
  const hidden = { templateId: id };

  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><strong>{template.code}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{CATEGORY_LABELS[template.category].toUpperCase()} TEMPLATE · {template.code}</p>
              <h1>{template.name}</h1>
              <div className="badges">
                {template.disabledAt ? <span className="badge red">Disabled</span> : published ? <span className="badge green">Enabled · v{published.version}</span> : null}
                {draft ? <span className="badge amber">Draft v{draft.version}</span> : null}
              </div>
            </div>
            <div className="toolbar-actions">
              {draft ? <a className="primary-button" href={`/quality/templates/${id}/draft`}>Continue draft v{draft.version}</a> : null}
              {!draft && published && may('qc_template.update') ? <RowAction action={startDraftAction} hidden={hidden} label="New version" className="primary-button" /> : null}
              {published ? <a className="ghost-button" href={`/api/qc/templates/${id}/versions/${published.version}/export`}>Export v{published.version}</a> : null}
              {may('qc_template.update') ? <RenameTemplateForm templateId={id} name={template.name} category={template.category} /> : null}
              {may('qc_template.publish') && published && !template.disabledAt ? (
                <RowAction action={disableTemplateAction} hidden={hidden} label="Disable" confirm="Disabled templates refuse new submissions. Existing submissions stay reviewable. Disable?" />
              ) : null}
              {may('qc_template.publish') && template.disabledAt ? <RowAction action={enableTemplateAction} hidden={hidden} label="Enable" className="ghost-button" /> : null}
            </div>
          </div>

          <section className="panel">
            <div className="panel-header"><div><h2>{published ? `Current version · v${published.version}` : 'Not published yet'}</h2>
              <p>{published ? `Published ${formatDate(published.publishedAt)}. Every project uses this version.` : 'Publish the draft to make this template available to projects.'}</p></div></div>
            {current?.state === 'ready' ? <VersionView sections={current.data.version.sections} /> : null}
          </section>

          <section className="panel">
            <div className="panel-header"><div><h2>Version history</h2></div></div>
            <table className="data-table">
              <thead><tr><th>Version</th><th>Status</th><th>Source</th><th>Published</th><th>Retired</th><th /></tr></thead>
              <tbody>
                {template.versions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version}</td>
                    <td><span className={`badge ${STATUS_BADGE[version.status]}`}>{version.status.toLowerCase()}</span></td>
                    <td>{version.source === 'EXCEL_IMPORT' ? 'Excel import' : 'Web editor'}</td>
                    <td>{formatDate(version.publishedAt)}</td>
                    <td>{formatDate(version.retiredAt)}</td>
                    <td className="row-actions">
                      {version.status === 'DRAFT'
                        ? <a href={`/quality/templates/${id}/draft`}>Edit</a>
                        : <a href={`/quality/templates/${id}/versions/${version.version}`}>View</a>}
                      <a href={`/api/qc/templates/${id}/versions/${version.version}/export`}>Export</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 9: The version page**

Create `apps/web/app/quality/templates/[id]/versions/[version]/page.tsx`:

```tsx
import { getVersion } from '../../../../../lib/qc-api';
import { Sidebar, StatePage, TopActions } from '../../../../../shell';
import { formatDate } from '../../../labels';
import { VersionView } from '../../../version-view';

export default async function VersionPage({ params }: { params: Promise<{ id: string; version: string }> }) {
  const { id, version } = await params;
  const number = Number(version);
  if (!Number.isInteger(number) || number < 1) return <StatePage title="Unknown version"><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  const result = await getVersion(id, number);
  if (result.state === 'unauthenticated') {
    return <StatePage title="Sign in to view this template"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (result.state !== 'ready') {
    return <StatePage title="This version is not available"><p>{result.message}</p><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  }
  const { template, version: detail } = result.data;
  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><a href={`/quality/templates/${id}`}>{template.code}</a><b>/</b><strong>v{detail.version}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{template.code} · VERSION {detail.version} · {detail.status}</p>
              <h1>{template.name}</h1>
              <p className="subtle">Published {formatDate(detail.publishedAt)}{detail.retiredAt ? `, retired ${formatDate(detail.retiredAt)}` : ''}.</p>
            </div>
            <a className="ghost-button" href={`/api/qc/templates/${id}/versions/${detail.version}/export`}>Export</a>
          </div>
          <section className="panel"><VersionView sections={detail.sections} /></section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 10: Styles**

Append to `apps/web/app/styles.css`:

```css
/* --- Quality & EHS -------------------------------------------------------- */

.toolbar-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.badge.red { background: #ffebed; color: #c34a52; }
.badge.blue { background: #edf2ff; color: #3568d7; }
.inline-details > summary { list-style: none; cursor: pointer; }
.inline-details[open] > form { margin-top: 12px; }
.checklist { display: grid; gap: 12px; margin-top: 16px; }
.checklist-section { border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; }
.checklist-section > summary { cursor: pointer; font-size: 14px; }
.checklist-items { margin: 12px 0 0; padding-left: 0; list-style: none; display: grid; gap: 10px; }
.checklist-item { padding: 10px 0; border-top: 1px solid #edf0f4; }
.checklist-item p { margin: 6px 0 0; }
.field-error { color: #c34a52; font-size: 12px; }
.banner.warning { background: #fff3e0; color: #8a5300; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; gap: 12px; align-items: center; }
.editor-section { border: 1px solid var(--line); border-radius: 10px; padding: 16px; background: #fff; }
.editor-section + .editor-section { margin-top: 16px; }
.editor-section-header { display: grid; grid-template-columns: 110px 1fr auto; gap: 12px; align-items: end; }
.editor-item { display: grid; grid-template-columns: 90px 1fr; gap: 10px 12px; padding: 14px 0; border-top: 1px solid #edf0f4; margin-top: 14px; }
.editor-item-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.editor-controls { display: flex; gap: 6px; flex-wrap: wrap; }
.editor-controls button { padding: 6px 10px; }
.editor-bar { position: sticky; bottom: 0; display: flex; gap: 10px; align-items: center; padding: 12px 0; background: var(--pale); }
@media (max-width: 700px) { .editor-section-header, .editor-item { grid-template-columns: 1fr; } }
```

- [ ] **Step 11: Verify**

Run: `pnpm --filter web exec vitest run && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS; clean.

Then check the screens in the browser (see Task 16 Step 6 for starting the stack): sign in as `qc`, open `/quality/templates`, switch tabs, filter, create a template (lands on the draft URL — a 404 until Task 16 is expected), open a detail page, rename, disable/enable a published template, open a version, and click both Export and Download blank workbook.

- [ ] **Step 12: Commit**

```bash
git add apps/web/app/shell.tsx apps/web/app/shell.spec.tsx apps/web/app/styles.css apps/web/app/quality
git commit -m "feat(web): add the checklist template list, detail and version screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Import from Excel screen

**Files:**
- Create: `apps/web/app/quality/templates/import/actions.ts`, `actions.spec.ts`
- Create: `apps/web/app/quality/templates/import/import-form.tsx`
- Create: `apps/web/app/quality/templates/import/page.tsx`

**Interfaces:**
- Consumes: `previewTemplateImport`, `commitTemplateImport` (Task 12); `TemplateImportPreview`, `ImportCommitDto` (Task 1, type-only).
- Produces: `previewTemplateImportAction(state: TemplateImportState, form: FormData)`, `commitTemplateImportAction(state, form)`; `TemplateImportState = FormState & { preview?: TemplateImportPreview }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/quality/templates/import/actions.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); }) }));

const previewTemplateImport = vi.fn();
const commitTemplateImport = vi.fn();
vi.mock('../../../lib/qc-api', () => ({ previewTemplateImport, commitTemplateImport }));

const { previewTemplateImportAction, commitTemplateImportAction } = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';

beforeEach(() => { vi.clearAllMocks(); });

describe('previewTemplateImportAction', () => {
  it('asks for a file', async () => {
    expect((await previewTemplateImportAction({}, new FormData())).error).toContain('Choose a .xlsx file');
    expect(previewTemplateImport).not.toHaveBeenCalled();
  });

  it('returns the preview', async () => {
    const preview = { metadata: null, target: null, warnings: [], errors: [{ row: 2, column: 'Code', message: 'x' }], document: null, summary: null };
    previewTemplateImport.mockResolvedValue({ state: 'ready', data: preview });
    const form = new FormData();
    form.set('file', new File(['x'], 'c.xlsx'));
    expect((await previewTemplateImportAction({}, form)).preview).toEqual(preview);
  });
});

describe('commitTemplateImportAction', () => {
  it('refuses a payload that is not JSON', async () => {
    const form = new FormData();
    form.set('payload', 'not json');
    expect((await commitTemplateImportAction({}, form)).error).toContain('Preview the file again');
    expect(commitTemplateImport).not.toHaveBeenCalled();
  });

  it('commits and opens the draft', async () => {
    commitTemplateImport.mockResolvedValue({ state: 'ready', data: { templateId: ID, draft: {} } });
    const form = new FormData();
    form.set('payload', JSON.stringify({ code: 'A', name: 'A', category: 'QUALITY', document: { sections: [] } }));
    await expect(commitTemplateImportAction({}, form)).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}/draft`);
  });
});
```

Run: `pnpm --filter web exec vitest run app/quality/templates/import`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement actions, form and page**

Create `apps/web/app/quality/templates/import/actions.ts`:

```ts
'use server';
import { redirect } from 'next/navigation';
import type { ImportCommitDto, TemplateImportPreview } from '@ipms/contracts';
import { commitTemplateImport, previewTemplateImport } from '../../../lib/qc-api';
import type { FormState } from '../../../lib/form-state';
import { settle } from '../../../lib/settle';

export interface TemplateImportState extends FormState {
  preview?: TemplateImportPreview;
}

export async function previewTemplateImportAction(_previous: TemplateImportState, form: FormData): Promise<TemplateImportState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a .xlsx file to preview.' };
  const result = await previewTemplateImport(file);
  const state = await settle(result, '/quality/templates/import');
  if (state.error) return state;
  return result.state === 'ready' ? { preview: result.data } : state;
}

export async function commitTemplateImportAction(_previous: TemplateImportState, form: FormData): Promise<TemplateImportState> {
  let payload: ImportCommitDto | null;
  try {
    payload = JSON.parse(String(form.get('payload'))) as ImportCommitDto | null;
  } catch {
    payload = null;
  }
  if (!payload) return { error: 'Preview the file again before importing.' };
  const result = await commitTemplateImport(payload);
  const state = await settle(result, ['/quality/templates']);
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/quality/templates/${result.data.templateId}/draft`);
  return state;
}
```

Create `apps/web/app/quality/templates/import/import-form.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import type { TemplateImportPreview } from '@ipms/contracts';
import { FormError, SubmitButton } from '../../../projects/forms';
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
```

Create `apps/web/app/quality/templates/import/page.tsx`:

```tsx
import { Sidebar, TopActions } from '../../../shell';
import { TemplateImportForm } from './import-form';

export default function TemplateImportPage() {
  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><strong>Import from Excel</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Import a checklist from Excel</h2>
                <p>A new Code creates a new template. An existing Code becomes that template&apos;s next draft. Nothing is saved until you confirm the preview.</p>
              </div>
              <a className="ghost-button" href="/api/qc/templates/blank">Download blank workbook</a>
            </div>
            <TemplateImportForm />
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter web exec vitest run && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS; clean. In the browser: import the blank workbook unchanged (three metadata errors), fill Code/Name/Category in Excel and import again (preview summary: 2 sections · 5 items · 1 critical · 3 with photos), then confirm.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/quality/templates/import
git commit -m "feat(web): import checklist templates from Excel with a preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Draft editor state

**Files:**
- Create: `apps/web/app/quality/templates/[id]/draft/editor-state.ts`
- Create: `apps/web/app/quality/templates/[id]/draft/editor-state.spec.ts`

**Interfaces:**
- Consumes: `ChecklistSection` shape (Task 12), `TemplateDocumentInput`, `ResponseType`, `Severity` (type-only).
- Produces: `EditorItem`, `EditorSection`, `EditorState`, `EditorAction`; `fromSections(sections: readonly WireSection[]): EditorState`; `editorReducer(state, action): EditorState`; `toDocument(state): TemplateDocumentInput`; `nextSectionNumber(sections)`; `nextItemNumber(section)`; `normalizeErrors(details: Record<string, string>): Record<string, string>`; `fieldKey(sectionIndex: number, itemIndex: number | null, field: string): string`. Pure module — no React, no `'use client'` — so a server action can import `normalizeErrors`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/quality/templates/[id]/draft/editor-state.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { editorReducer, fieldKey, fromSections, nextItemNumber, nextSectionNumber, normalizeErrors, toDocument, type EditorState } from './editor-state';

const WIRE = [
  { number: '1', title: 'EHS', items: [
    { number: '1.1', requirementText: 'PPE', severity: 'CRITICAL' as const, responseType: 'RESULT_ONLY' as const, selectOptions: [], minPhotos: 1, maxPhotos: 3, allowsNa: false, isRequired: true, guidanceText: 'Helmet' },
    { number: '1.2', requirementText: 'Mount', severity: 'NORMAL' as const, responseType: 'SELECT' as const, selectOptions: ['Pole', 'Wall'], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true, guidanceText: null },
  ] },
  { number: '2', title: 'Antenna', items: [] },
];

const start = (): EditorState => fromSections(WIRE);
const numbers = (state: EditorState) => state.sections.map((s) => [s.number, s.items.map((i) => i.number)]);

describe('fromSections / toDocument', () => {
  it('round-trips a version, joining options one per line', () => {
    const state = start();
    expect(state.sections[0]!.items[1]!.optionsText).toBe('Pole\nWall');
    expect(state.dirty).toBe(false);
    expect(toDocument(state)).toEqual({
      sections: [
        { number: '1', title: 'EHS', items: [
          { number: '1.1', requirementText: 'PPE', severity: 'CRITICAL', responseType: 'RESULT_ONLY', selectOptions: [], minPhotos: 1, maxPhotos: 3, allowsNa: false, isRequired: true, guidanceText: 'Helmet' },
          { number: '1.2', requirementText: 'Mount', severity: 'NORMAL', responseType: 'SELECT', selectOptions: ['Pole', 'Wall'], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true },
        ] },
        { number: '2', title: 'Antenna', items: [] },
      ],
    });
  });

  it('drops options when the item is no longer a Select', () => {
    const state = start();
    const s = state.sections[0]!;
    const next = editorReducer(state, { type: 'updateItem', sectionKey: s.key, itemKey: s.items[1]!.key, patch: { responseType: 'TEXT' } });
    expect(toDocument(next).sections[0]!.items[1]!.selectOptions).toEqual([]);
  });
});

describe('numbering', () => {
  it('suggests the next section and item numbers', () => {
    const state = start();
    expect(nextSectionNumber(state.sections)).toBe('3');
    expect(nextItemNumber(state.sections[0]!)).toBe('1.3');
    expect(nextItemNumber(state.sections[1]!)).toBe('2.1');
  });

  it('adds a section and an item with those numbers and marks the state dirty', () => {
    let state = editorReducer(start(), { type: 'addSection' });
    state = editorReducer(state, { type: 'addItem', sectionKey: state.sections[2]!.key });
    expect(numbers(state)).toEqual([['1', ['1.1', '1.2']], ['2', []], ['3', ['3.1']]]);
    expect(state.dirty).toBe(true);
  });

  it('renumbers everything from position', () => {
    let state = start();
    state = editorReducer(state, { type: 'moveSection', sectionKey: state.sections[1]!.key, direction: -1 });
    state = editorReducer(state, { type: 'renumber' });
    expect(numbers(state)).toEqual([['1', []], ['2', ['2.1', '2.2']]]);
  });
});

describe('moving and removing', () => {
  it('moves an item within its section and ignores a move past the edge', () => {
    const state = start();
    const s = state.sections[0]!;
    const moved = editorReducer(state, { type: 'moveItem', sectionKey: s.key, itemKey: s.items[1]!.key, direction: -1 });
    expect(moved.sections[0]!.items.map((i) => i.number)).toEqual(['1.2', '1.1']);
    expect(editorReducer(state, { type: 'moveItem', sectionKey: s.key, itemKey: s.items[0]!.key, direction: -1 })).toBe(state);
  });

  it('removes a section and an item', () => {
    let state = start();
    state = editorReducer(state, { type: 'removeItem', sectionKey: state.sections[0]!.key, itemKey: state.sections[0]!.items[0]!.key });
    state = editorReducer(state, { type: 'removeSection', sectionKey: state.sections[1]!.key });
    expect(numbers(state)).toEqual([['1', ['1.2']]]);
  });

  it('clears dirty on save', () => {
    const dirty = editorReducer(start(), { type: 'addSection' });
    expect(editorReducer(dirty, { type: 'saved' }).dirty).toBe(false);
  });
});

describe('normalizeErrors', () => {
  it('strips the request wrapper and folds option indexes into the field', () => {
    expect(normalizeErrors({
      'document.sections.0.items.1.maxPhotos': 'Must be at least Min Photos (2)',
      'sections.0.items.1.selectOptions.3': 'Too long',
      'sections.1.items': 'Every section needs at least one item',
    })).toEqual({
      'sections.0.items.1.maxPhotos': 'Must be at least Min Photos (2)',
      'sections.0.items.1.selectOptions': 'Too long',
      'sections.1.items': 'Every section needs at least one item',
    });
    expect(fieldKey(0, 1, 'maxPhotos')).toBe('sections.0.items.1.maxPhotos');
    expect(fieldKey(1, null, 'items')).toBe('sections.1.items');
  });
});
```

Run: `pnpm --filter web exec vitest run 'app/quality/templates/\[id\]/draft'`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Create `apps/web/app/quality/templates/[id]/draft/editor-state.ts`:

```ts
import type { ResponseType, Severity, TemplateDocumentInput } from '@ipms/contracts';

export interface EditorItem {
  key: string; number: string; requirementText: string; severity: Severity; responseType: ResponseType;
  optionsText: string; minPhotos: number; maxPhotos: number; allowsNa: boolean; isRequired: boolean; guidanceText: string;
}
export interface EditorSection { key: string; number: string; title: string; items: EditorItem[] }
export interface EditorState { sections: EditorSection[]; dirty: boolean }

export interface WireSection {
  number: string; title: string;
  items: readonly {
    number: string; requirementText: string; severity: Severity; responseType: ResponseType; selectOptions: readonly string[];
    minPhotos: number; maxPhotos: number; allowsNa: boolean; isRequired: boolean; guidanceText: string | null;
  }[];
}

export type ItemPatch = Partial<Omit<EditorItem, 'key'>>;
export type EditorAction =
  | { type: 'addSection' }
  | { type: 'removeSection'; sectionKey: string }
  | { type: 'moveSection'; sectionKey: string; direction: -1 | 1 }
  | { type: 'updateSection'; sectionKey: string; patch: Partial<Pick<EditorSection, 'number' | 'title'>> }
  | { type: 'addItem'; sectionKey: string }
  | { type: 'removeItem'; sectionKey: string; itemKey: string }
  | { type: 'moveItem'; sectionKey: string; itemKey: string; direction: -1 | 1 }
  | { type: 'updateItem'; sectionKey: string; itemKey: string; patch: ItemPatch }
  | { type: 'renumber' }
  | { type: 'saved' };

let counter = 0;
const newKey = (): string => `k${(counter += 1).toString(36)}`;

export function fromSections(sections: readonly WireSection[]): EditorState {
  return {
    dirty: false,
    sections: sections.map((section) => ({
      key: newKey(), number: section.number, title: section.title,
      items: section.items.map((item) => ({
        key: newKey(), number: item.number, requirementText: item.requirementText, severity: item.severity,
        responseType: item.responseType, optionsText: item.selectOptions.join('\n'), minPhotos: item.minPhotos,
        maxPhotos: item.maxPhotos, allowsNa: item.allowsNa, isRequired: item.isRequired, guidanceText: item.guidanceText ?? '',
      })),
    })),
  };
}

export function toDocument(state: EditorState): TemplateDocumentInput {
  return {
    sections: state.sections.map((section) => ({
      number: section.number.trim(),
      title: section.title.trim(),
      items: section.items.map((item) => ({
        number: item.number.trim(),
        requirementText: item.requirementText.trim(),
        severity: item.severity,
        responseType: item.responseType,
        selectOptions: item.responseType === 'SELECT' ? item.optionsText.split('\n').map((option) => option.trim()).filter(Boolean) : [],
        minPhotos: item.minPhotos,
        maxPhotos: item.maxPhotos,
        allowsNa: item.allowsNa,
        isRequired: item.isRequired,
        ...(item.guidanceText.trim() ? { guidanceText: item.guidanceText.trim() } : {}),
      })),
    })),
  };
}

const leadingInt = (text: string): number => Number.parseInt(text, 10);

export function nextSectionNumber(sections: readonly EditorSection[]): string {
  return String(Math.max(0, ...sections.map((section) => leadingInt(section.number)).filter(Number.isFinite)) + 1);
}

export function nextItemNumber(section: EditorSection): string {
  const prefix = `${section.number}.`;
  const used = section.items
    .map((item) => (item.number.startsWith(prefix) ? leadingInt(item.number.slice(prefix.length)) : Number.NaN))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

function blankItem(number: string): EditorItem {
  return {
    key: newKey(), number, requirementText: '', severity: 'NORMAL', responseType: 'RESULT_ONLY', optionsText: '',
    minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true, guidanceText: '',
  };
}

function move<T extends { key: string }>(list: readonly T[], key: string, direction: -1 | 1): T[] | null {
  const from = list.findIndex((entry) => entry.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return null;
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}

function withSection(state: EditorState, key: string, change: (section: EditorSection) => EditorSection): EditorState {
  return { dirty: true, sections: state.sections.map((section) => (section.key === key ? change(section) : section)) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'addSection':
      return { dirty: true, sections: [...state.sections, { key: newKey(), number: nextSectionNumber(state.sections), title: '', items: [] }] };
    case 'removeSection':
      return { dirty: true, sections: state.sections.filter((section) => section.key !== action.sectionKey) };
    case 'moveSection': {
      const sections = move(state.sections, action.sectionKey, action.direction);
      return sections ? { dirty: true, sections } : state;
    }
    case 'updateSection':
      return withSection(state, action.sectionKey, (section) => ({ ...section, ...action.patch }));
    case 'addItem':
      return withSection(state, action.sectionKey, (section) => ({ ...section, items: [...section.items, blankItem(nextItemNumber(section))] }));
    case 'removeItem':
      return withSection(state, action.sectionKey, (section) => ({ ...section, items: section.items.filter((item) => item.key !== action.itemKey) }));
    case 'moveItem': {
      const section = state.sections.find((entry) => entry.key === action.sectionKey);
      const items = section ? move(section.items, action.itemKey, action.direction) : null;
      return items ? withSection(state, action.sectionKey, (entry) => ({ ...entry, items })) : state;
    }
    case 'updateItem':
      return withSection(state, action.sectionKey, (section) => ({
        ...section,
        items: section.items.map((item) => (item.key === action.itemKey ? { ...item, ...action.patch } : item)),
      }));
    case 'renumber':
      return {
        dirty: true,
        sections: state.sections.map((section, s) => ({
          ...section,
          number: String(s + 1),
          items: section.items.map((item, i) => ({ ...item, number: `${s + 1}.${i + 1}` })),
        })),
      };
    case 'saved':
      return { ...state, dirty: false };
  }
}

export function fieldKey(sectionIndex: number, itemIndex: number | null, field: string): string {
  return itemIndex === null ? `sections.${sectionIndex}.${field}` : `sections.${sectionIndex}.items.${itemIndex}.${field}`;
}

/** Server paths arrive as `document.sections.0.items.1.selectOptions.3`; the editor marks `sections.0.items.1.selectOptions`. */
export function normalizeErrors(details: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [path, message] of Object.entries(details)) {
    const key = path.replace(/^document\./, '').replace(/\.selectOptions\.\d+$/, '.selectOptions');
    normalized[key] ??= message;
  }
  return normalized;
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter web exec vitest run 'app/quality/templates/\[id\]/draft' && pnpm --filter web typecheck`
Expected: PASS (9 tests); typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add 'apps/web/app/quality/templates/[id]/draft/editor-state.ts' 'apps/web/app/quality/templates/[id]/draft/editor-state.spec.ts'
git commit -m "feat(web): add the draft editor's document state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Draft editor screen

**Files:**
- Create: `apps/web/app/quality/templates/[id]/draft/actions.ts`, `actions.spec.ts`
- Create: `apps/web/app/quality/templates/[id]/draft/draft-editor.tsx`
- Create: `apps/web/app/quality/templates/[id]/draft/page.tsx`

**Interfaces:**
- Consumes: `saveDraft`, `publishTemplate`, `discardDraft`, `getTemplate`, `getVersion` (Task 12); `editorReducer`, `fromSections`, `toDocument`, `normalizeErrors`, `fieldKey` (Task 15).
- Produces: `EditorResult = { revision: number | null; error: string | null; fieldErrors: Record<string, string>; conflict: boolean }`; server actions `saveDraftAction(templateId, revision, document): Promise<EditorResult>`, `publishDraftAction(templateId, revision, document): Promise<EditorResult>` (redirects to the detail page on success), `discardDraftAction(templateId): Promise<EditorResult>` (redirects on success).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/quality/templates/[id]/draft/actions.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); }) }));

const qc = { saveDraft: vi.fn(), publishTemplate: vi.fn(), discardDraft: vi.fn() };
vi.mock('../../../../lib/qc-api', () => qc);

const { saveDraftAction, publishDraftAction, discardDraftAction } = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';
const DOC = { sections: [] };

beforeEach(() => { vi.clearAllMocks(); });

describe('saveDraftAction', () => {
  it('returns the new revision', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'ready', data: { revision: 4 } });
    expect(await saveDraftAction(ID, 3, DOC)).toEqual({ revision: 4, error: null, fieldErrors: {}, conflict: false });
    expect(qc.saveDraft).toHaveBeenCalledWith(ID, { revision: 3, document: DOC });
  });

  it('maps validation details to editor fields', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'unavailable', status: 422, message: 'Request validation failed', details: { 'document.sections.0.title': 'Required' } });
    expect(await saveDraftAction(ID, 3, DOC)).toEqual({ revision: null, error: 'Request validation failed', fieldErrors: { 'sections.0.title': 'Required' }, conflict: false });
  });

  it('flags a stale revision as a conflict', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'unavailable', status: 409, message: 'Someone else saved this draft.' });
    expect((await saveDraftAction(ID, 3, DOC)).conflict).toBe(true);
  });
});

describe('publishDraftAction', () => {
  it('saves, publishes and opens the template', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'ready', data: { revision: 4 } });
    qc.publishTemplate.mockResolvedValue({ state: 'ready', data: {} });
    await expect(publishDraftAction(ID, 3, DOC)).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}`);
  });

  it('keeps the saved revision when publishing is refused', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'ready', data: { revision: 4 } });
    qc.publishTemplate.mockResolvedValue({ state: 'unavailable', status: 422, message: 'Request validation failed', details: { 'sections.1.items': 'Every section needs at least one item' } });
    expect(await publishDraftAction(ID, 3, DOC)).toEqual({
      revision: 4, error: 'Request validation failed', fieldErrors: { 'sections.1.items': 'Every section needs at least one item' }, conflict: false,
    });
  });

  it('does not publish when the save fails', async () => {
    qc.saveDraft.mockResolvedValue({ state: 'unavailable', status: 409, message: 'stale' });
    await publishDraftAction(ID, 3, DOC);
    expect(qc.publishTemplate).not.toHaveBeenCalled();
  });
});

describe('discardDraftAction', () => {
  it('goes back to the list when the template went with its draft', async () => {
    qc.discardDraft.mockResolvedValue({ state: 'ready', data: { templateDeleted: true } });
    await expect(discardDraftAction(ID)).rejects.toThrow('NEXT_REDIRECT /quality/templates?tab=draft');
  });

  it('goes back to the template otherwise', async () => {
    qc.discardDraft.mockResolvedValue({ state: 'ready', data: { templateDeleted: false } });
    await expect(discardDraftAction(ID)).rejects.toThrow(`NEXT_REDIRECT /quality/templates/${ID}`);
  });
});
```

Run: `pnpm --filter web exec vitest run 'app/quality/templates/\[id\]/draft/actions.spec.ts'`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the actions**

Create `apps/web/app/quality/templates/[id]/draft/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { TemplateDocumentInput } from '@ipms/contracts';
import type { ApiResult } from '../../../../lib/api-client';
import { discardDraft, publishTemplate, saveDraft } from '../../../../lib/qc-api';
import { normalizeErrors } from './editor-state';

export interface EditorResult { revision: number | null; error: string | null; fieldErrors: Record<string, string>; conflict: boolean }

const LIST = '/quality/templates';

function failure(result: Exclude<ApiResult<unknown>, { state: 'ready' }>, revision: number | null): EditorResult {
  if (result.state === 'unauthenticated') redirect('/login');
  if (result.state === 'forbidden') return { revision, error: result.message, fieldErrors: {}, conflict: false };
  return { revision, error: result.message, fieldErrors: normalizeErrors(result.details ?? {}), conflict: result.status === 409 };
}

export async function saveDraftAction(templateId: string, revision: number, document: TemplateDocumentInput): Promise<EditorResult> {
  const saved = await saveDraft(templateId, { revision, document });
  if (saved.state !== 'ready') return failure(saved, null);
  revalidatePath(LIST);
  return { revision: saved.data.revision, error: null, fieldErrors: {}, conflict: false };
}

export async function publishDraftAction(templateId: string, revision: number, document: TemplateDocumentInput): Promise<EditorResult> {
  const saved = await saveDraft(templateId, { revision, document });
  if (saved.state !== 'ready') return failure(saved, null);
  const published = await publishTemplate(templateId);
  if (published.state !== 'ready') return failure(published, saved.data.revision);
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${templateId}`);
  redirect(`${LIST}/${templateId}`);
}

export async function discardDraftAction(templateId: string): Promise<EditorResult> {
  const result = await discardDraft(templateId);
  if (result.state !== 'ready') return failure(result, null);
  revalidatePath(LIST);
  redirect(result.data.templateDeleted ? `${LIST}?tab=draft` : `${LIST}/${templateId}`);
}
```

Run: `pnpm --filter web exec vitest run 'app/quality/templates/\[id\]/draft'`
Expected: PASS.

- [ ] **Step 3: The editor component**

Create `apps/web/app/quality/templates/[id]/draft/draft-editor.tsx`:

```tsx
'use client';
import { useEffect, useReducer, useState, useTransition } from 'react';
import type { ResponseType, Severity } from '@ipms/contracts';
import { RESPONSE_TYPES, RESPONSE_TYPE_LABELS } from '../../labels';
import { discardDraftAction, publishDraftAction, saveDraftAction, type EditorResult } from './actions';
import { editorReducer, fieldKey, fromSections, toDocument, type EditorItem, type EditorSection, type ItemPatch, type WireSection } from './editor-state';

interface Props {
  templateId: string; version: number; revision: number; sections: WireSection[];
  previousVersion: number | null; neverPublished: boolean;
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error" role="alert">{message}</span> : null;
}

export function DraftEditor({ templateId, version, revision: initialRevision, sections, previousVersion, neverPublished }: Props) {
  const [state, dispatch] = useReducer(editorReducer, sections, fromSections);
  const [revision, setRevision] = useState(initialRevision);
  const [result, setResult] = useState<EditorResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = result?.fieldErrors ?? {};

  useEffect(() => {
    if (!state.dirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.dirty]);

  function apply(next: EditorResult, success: string | null): void {
    if (next.revision !== null) { setRevision(next.revision); dispatch({ type: 'saved' }); }
    setResult(next);
    setNotice(next.error ? null : success);
  }

  const save = (): void => startTransition(async () => apply(await saveDraftAction(templateId, revision, toDocument(state)), 'Draft saved.'));

  const publish = (): void => {
    const message = previousVersion
      ? `v${version} will be used by all projects from now on, and v${previousVersion} retires. Publish?`
      : `v${version} will become available to all projects. Publish?`;
    if (!window.confirm(message)) return;
    startTransition(async () => apply(await publishDraftAction(templateId, revision, toDocument(state)), null));
  };

  const discard = (): void => {
    const message = neverPublished
      ? 'Discard this draft? The template itself will be deleted, because it has never been published.'
      : `Discard the v${version} draft? The published version is not affected.`;
    if (!window.confirm(message)) return;
    startTransition(async () => { dispatch({ type: 'saved' }); apply(await discardDraftAction(templateId), null); });
  };

  const updateItem = (section: EditorSection, item: EditorItem, patch: ItemPatch): void =>
    dispatch({ type: 'updateItem', sectionKey: section.key, itemKey: item.key, patch });

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
              <button type="button" className="ghost-button" aria-label={`Move section ${section.number} up`} onClick={() => dispatch({ type: 'moveSection', sectionKey: section.key, direction: -1 })}>↑</button>
              <button type="button" className="ghost-button" aria-label={`Move section ${section.number} down`} onClick={() => dispatch({ type: 'moveSection', sectionKey: section.key, direction: 1 })}>↓</button>
              <button type="button" className="danger-button" onClick={() => { if (section.items.length === 0 || window.confirm(`Remove section ${section.number} and its ${section.items.length} items?`)) dispatch({ type: 'removeSection', sectionKey: section.key }); }}>Remove</button>
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
                  </label>
                  <div className="editor-controls">
                    <button type="button" className="ghost-button" aria-label={`Move item ${item.number} up`} onClick={() => dispatch({ type: 'moveItem', sectionKey: section.key, itemKey: item.key, direction: -1 })}>↑</button>
                    <button type="button" className="ghost-button" aria-label={`Move item ${item.number} down`} onClick={() => dispatch({ type: 'moveItem', sectionKey: section.key, itemKey: item.key, direction: 1 })}>↓</button>
                    <button type="button" className="danger-button" onClick={() => dispatch({ type: 'removeItem', sectionKey: section.key, itemKey: item.key })}>Remove item</button>
                  </div>
                </div>
              </div>
            );
          })}
          <button type="button" className="ghost-button" onClick={() => dispatch({ type: 'addItem', sectionKey: section.key })}>Add item</button>
        </section>
      ))}

      <div className="editor-bar">
        <button type="button" className="ghost-button" onClick={() => dispatch({ type: 'addSection' })}>Add section</button>
        <button type="button" className="ghost-button" onClick={() => dispatch({ type: 'renumber' })}>Renumber</button>
        <span className="subtle">{state.dirty ? 'Unsaved changes' : `Saved · revision ${revision}`}</span>
        <button type="button" className="primary-button" disabled={pending} onClick={save}>{pending ? 'Working…' : 'Save draft'}</button>
        <button type="button" className="primary-button" disabled={pending} onClick={publish}>Publish v{version}</button>
        <button type="button" className="danger-button" disabled={pending} onClick={discard}>Discard draft</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: The editor page**

Create `apps/web/app/quality/templates/[id]/draft/page.tsx`:

```tsx
import { getCurrentUser, hasPermission } from '../../../../lib/iam-api';
import { getTemplate, getVersion } from '../../../../lib/qc-api';
import { Sidebar, StatePage, TopActions } from '../../../../shell';
import { DraftEditor } from './draft-editor';

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, viewer] = await Promise.all([getTemplate(id), getCurrentUser()]);
  if (detail.state === 'unauthenticated') {
    return <StatePage title="Sign in to edit this template"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (detail.state !== 'ready') {
    return <StatePage title="This template is not available"><p>{detail.message}</p><a href="/quality/templates">Back to templates</a></StatePage>;
  }
  if (!(viewer.state === 'ready' && hasPermission(viewer.data, 'qc_template.update'))) {
    return <StatePage title="Your account cannot edit templates"><p>Ask for a role that grants <code>qc_template.update</code>.</p><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  }
  const template = detail.data;
  const draft = template.versions.find((version) => version.status === 'DRAFT');
  if (!draft) {
    return <StatePage title="This template has no draft"><p>Start a new version from the template page.</p><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  }
  const loaded = await getVersion(id, draft.version);
  if (loaded.state !== 'ready') {
    return <StatePage title="The draft could not be loaded"><p>{loaded.state === 'unauthenticated' ? 'Sign in again.' : loaded.message}</p></StatePage>;
  }
  const previous = template.versions.find((version) => version.status === 'PUBLISHED')?.version ?? null;

  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><a href={`/quality/templates/${id}`}>{template.code}</a><b>/</b><strong>Draft v{draft.version}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">{template.code} · DRAFT v{draft.version}</p><h1>{template.name}</h1></div>
          </div>
          <DraftEditor
            templateId={id}
            version={draft.version}
            revision={loaded.data.version.revision}
            sections={loaded.data.version.sections}
            previousVersion={previous}
            neverPublished={template.currentVersionId === null}
          />
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Run the web checks**

Run: `pnpm --filter web exec vitest run && pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: PASS; typecheck, lint and build clean.

- [ ] **Step 6: Verify the editor in the browser**

Start the backend stack and the web app:

```bash
docker compose -f docker/docker-compose.yml up -d --build
pnpm --filter iam seed
IPMS_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter web dev
```

Using the in-app browser at `http://localhost:3100`, signed in as `qc`, check each of these and note anything that misbehaves:
1. Create a template → the editor opens empty. *Add section*, *Add item* (numbers `1`, `1.1`), fill a requirement, *Save draft* → "Draft saved", revision 2.
2. Set Min photos 3, Max photos 1, save → the error appears under Max photos.
3. Switch an item to Select with one option, save → the error appears under Options.
4. Add a second empty section, *Publish* → the "needs at least one item" message appears under that section, and the badge shows the saved revision.
5. Fix it, publish, confirm the dialog → you land on the detail page with v1 current.
6. *New version* → the editor opens with v1's content as v2; move an item up, *Renumber*, publish → history shows v2 published, v1 retired.
7. Open the same draft in two tabs, save in one, then save in the other → the conflict banner with *Reload* appears.
8. Edit something, then try to close the tab → the browser warns about unsaved changes.
9. Create another template, *Discard draft* → back to the Draft Box, and the template is gone.
10. Sign in as `engineer` → no Quality & EHS item in the sidebar; `/quality/templates` shows the forbidden state.
11. Sign in as `manager` (Project Manager) → the list is visible, with no *New template*, *Import* or lifecycle buttons.

- [ ] **Step 7: Commit**

```bash
git add 'apps/web/app/quality/templates/[id]/draft'
git commit -m "feat(web): add the checklist template draft editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: End-to-end lifecycle test and full verification

**Files:**
- Create: `e2e/qc-templates.e2e.spec.ts`

**Interfaces:**
- Consumes: `api`, `waitForReady` from `e2e/helpers/stack.ts`; the running Compose stack; demo users `qc`, `engineer` (password from `IAM_DEMO_PASSWORD`, `demo12345` in local development).

- [ ] **Step 1: Write the test**

Create `e2e/qc-templates.e2e.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { api, waitForReady } from './helpers/stack.js';

const BASE = process.env['E2E_GATEWAY_URL'] ?? 'http://localhost:3000';
const PASSWORD = process.env['IAM_DEMO_PASSWORD'] ?? 'demo12345';

async function login(username: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}

let qc: string;

beforeAll(async () => { await waitForReady(); qc = await login('qc'); }, 90_000);

describe('checklist template lifecycle', () => {
  it('create → save → publish → export → import the export → publish v2', async () => {
    const code = `E2E-${Date.now()}`;
    const created = await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code, name: 'E2E', category: 'QUALITY' } });
    expect(created.status).toBe(201);
    const id = created.body.templateId;

    const document = { sections: [{ number: '1', title: 'EHS', items: [{ number: '1.1', requirementText: 'PPE worn', severity: 'CRITICAL', minPhotos: 1, maxPhotos: 2 }] }] };
    expect((await api(`/api/v1/qc/templates/${id}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document } })).status).toBe(200);
    expect((await api(`/api/v1/qc/templates/${id}/publish`, { method: 'POST', token: qc })).status).toBe(201);

    const exported = await fetch(`${BASE}/api/v1/qc/templates/${id}/versions/1/export`, { headers: { authorization: `Bearer ${qc}` } });
    expect(exported.status).toBe(200);
    const form = new FormData();
    form.set('file', new Blob([await exported.arrayBuffer()]), 'export.xlsx');
    const previewRes = await fetch(`${BASE}/api/v1/qc/templates/import/preview`, { method: 'POST', headers: { authorization: `Bearer ${qc}` }, body: form });
    const preview = await previewRes.json() as { errors: unknown[]; target: unknown; metadata: object; document: object };
    expect(preview.errors).toEqual([]);
    expect(preview.target).toMatchObject({ kind: 'EXISTING', templateId: id, nextVersion: 2 });

    const committed = await api<{ draft: { version: number } }>('/api/v1/qc/templates/import/commit', { method: 'POST', token: qc, body: { ...preview.metadata, document: preview.document } });
    expect(committed.body.draft.version).toBe(2);
    expect((await api(`/api/v1/qc/templates/${id}/publish`, { method: 'POST', token: qc })).status).toBe(201);

    const detail = await api<{ versions: { version: number; status: string }[] }>(`/api/v1/qc/templates/${id}`, { token: qc });
    expect(detail.body.versions.map((v) => [v.version, v.status])).toEqual([[2, 'PUBLISHED'], [1, 'RETIRED']]);
  });

  it('keeps field engineers out of the library', async () => {
    const engineer = await login('engineer');
    expect((await api('/api/v1/qc/templates', { token: engineer })).status).toBe(403);
  });

  it('answers a validation failure with field paths', async () => {
    const res = await api<{ error: { code: string; details: Record<string, string> } }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: 'bad code', name: 'x', category: 'QUALITY' } });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toHaveProperty('code');
  });
});
```

- [ ] **Step 2: Run it against the stack**

```bash
docker compose -f docker/docker-compose.yml up -d --build
pnpm --filter iam seed
pnpm --dir e2e test -- qc-templates
```

Expected: PASS (3 tests). If the seed has not run against the Compose IAM database, the `engineer` test fails on the old Field Engineer permissions — re-run the seed with that database's `DATABASE_URL`.

- [ ] **Step 3: Run the whole workspace**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. Fix anything that is red before continuing — do not skip or disable tests.

- [ ] **Step 4: Commit**

```bash
git add e2e/qc-templates.e2e.spec.ts
git commit -m "test(e2e): cover the checklist template lifecycle end to end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Mark the spec approved**

In `docs/superpowers/specs/2026-09-22-qc-template-management-design.md` change `**Status:** Draft — awaiting review` to `**Status:** Implemented`, then:

```bash
git add docs/superpowers/specs/2026-09-22-qc-template-management-design.md
git commit -m "docs: mark the QC template management design implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
