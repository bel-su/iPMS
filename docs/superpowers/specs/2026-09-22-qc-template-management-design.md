# iPMS — QC Template Management Design

**Status:** Implemented — end-to-end run pending the docker-compose fix
**Date:** 2026-09-22
**Parent spec:** `2026-09-15-ipms-microservices-architecture-design.md` §4 (IEPMS findings), §7.2 (`qc`)
**Related specs:** `2026-09-20-site-bulk-import-and-geofence-design.md` (the preview/commit import this mirrors), `2026-09-22-user-management-design.md` (the web CRUD and audit shape this follows)

---

## 1. Context

The Quality & EHS module is being built as four sub-projects, each with its own
spec → plan → implementation cycle:

1. **Template Management** — this spec.
2. **Work Order Management** — web UI over `project` tasks, linking tasks to templates,
   and the `qc.submission.*` → task status sync.
3. **Work Order Audit** — submission listing, the per-item review UI, evidence photos
   (and therefore `media`), submission-side authorization.
4. **Reporting Dashboard** — pass rates, rectification counts, status by site,
   template and assignee.

`qc` already exists: templates, sections, items, submissions and per-item review, behind
`/api/v1/qc`, which the gateway routes. Its template model is **per project**
(`checklist_template.project_id`, `UNIQUE(project_id, code, version)`), it has no draft
editing, no disable, no Excel round-trip, and no web UI. `apps/web/app/lib/qc-api.ts` is
the only consumer of the API; neither the web screens nor the mobile app call it.

This sub-project turns templates into a **company-wide library** that any project can
use, adds the full authoring lifecycle (web editor and Excel), and builds the Template
Management screens.

### 1.1 Scope

**In**

- Company-wide templates with stable identity and immutable published versions.
- Draft lifecycle: create, save (whole document), publish, new version, discard,
  rename, disable, enable.
- Excel: blank workbook, export of any version, import with preview/commit.
- `GET /qc/tasks/:taskId/checklist` — how a field engineer obtains the checklist for
  their assigned task — and the `project` internal task lookup it depends on.
- Submissions reference a template **version**; submission against a recently
  retired version is accepted within a grace window.
- Audit events for template lifecycle actions, via a transactional outbox.
- IAM seed changes to the QC permissions of Project Manager and Field Engineer.
- Web: Template Management list, detail, version view, create, import and draft
  editor screens; navigation.

**Out**

- Sample pictures on items (`sample_photo_media_id`) — deferred to sub-project 3,
  which builds `media` uploads for evidence photos anyway.
- Linking templates to task types and tasks in the UI — sub-project 2.
- Submission listing, review UI, and submission-side scope/assignee enforcement —
  sub-project 3.
- Reporting — sub-project 4.
- Audit Settings and Rectification Management screens.
- Replicated scope projection (NATS). Authorization here is by permission only (§2).

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| T1 | Templates are company-wide; `project_id` is removed | One checklist serves every project; no per-project copies to drift apart |
| T2 | Split `ChecklistTemplate` (stable identity) from `TemplateVersion` (content) | Tasks reference something that never changes; content is versioned under it |
| T3 | Projects always use the latest published version | "One library for all projects" implies it; no per-project pinning or upgrade screen |
| T4 | Publishing retires the previous version; submissions against it are accepted for a grace window (default 7 days) | A phone that downloaded v1 offline can still submit after v2 is published |
| T5 | Drafts are edited as a whole document, saved atomically, guarded by a revision number | Web editor and Excel import share one write path and one validator; no half-saved drafts |
| T6 | Both authoring paths: Excel round-trip and a web editor | Bulk authoring happens in Excel; small corrections should not need a re-import |
| T7 | Library changes are authorized by permission; only QC Manager and Super Admin hold `qc_template` write permissions | Scope is not replicated to `qc` yet, so "global scope" is unenforceable; the seed already describes QC Manager as owning templates |
| T8 | Field engineers do not browse the library; they receive the checklist of a task assigned to them | They are responsible only for their assigned work |
| T9 | Destructive migration of the `qc` template tables | `qc` has never held production data |
| T10 | Sample pictures deferred | `media` is a scaffold; build it once, in sub-project 3 |

---

## 3. Data model

### 3.1 Schema

```
ChecklistTemplate   id · code UNIQUE · name · category: QUALITY | EHS | OTHER
                    current_version_id? → TemplateVersion
                    disabled_at? · created_by · created_at · updated_at

TemplateVersion     id · template_id · version · status: DRAFT | PUBLISHED | RETIRED
                    revision · source: WEB | EXCEL_IMPORT
                    created_by · created_at · updated_at
                    published_at? · published_by? · retired_at?
                    UNIQUE(template_id, version)
                    UNIQUE(template_id) WHERE status = 'DRAFT'
                    UNIQUE(template_id) WHERE status = 'PUBLISHED'

ChecklistSection    id · version_id · number · title · order
                    UNIQUE(version_id, number)

ChecklistItem       id · section_id · number · requirement_text
                    severity: NORMAL | CRITICAL
                    response_type: RESULT_ONLY | TEXT | NUMBER | BOOLEAN | SELECT
                    select_options text[] · min_photos · max_photos
                    allows_na · is_required · guidance_text? · order
                    UNIQUE(section_id, number)
```

- `code` is immutable after creation; `name` and `category` are template metadata,
  editable at any time and not versioned.
- `requires_photo` is dropped. "Photo required" is `min_photos >= 1`; `max_photos = 0`
  means no photos.
- The two partial unique indexes are hand-written in the migration (Prisma cannot
  express them), as IAM does for role assignments.
- `current_version_id` always points at the `PUBLISHED` version, or is null for a
  template never published.

### 3.2 Submission changes

`Submission` gains `template_version_id` (FK to `TemplateVersion`). `template_id` stays
and now references the template identity; `template_version` (the number) stays for
display. `ItemResponse.item_id` continues to reference `ChecklistItem`, which now belongs
to a specific version.

### 3.3 Migration

One migration drops and recreates every `qc` table — `checklist_template`,
`checklist_section`, `checklist_item`, `submission`, `item_response`, `item_photo`,
`review_decision` — adds `template_version` and `outbox_event`, and creates the partial
unique indexes. No data is converted (T9).

---

## 4. Lifecycle

| Action | Precondition | Effect |
|---|---|---|
| Create | Code unused | Template + empty v1 `DRAFT` (revision 1, source `WEB`) |
| Save draft | A draft exists; `revision` matches | Sections and items replaced in one transaction; `revision + 1` |
| Publish | A draft exists; template not disabled; draft passes publish validation (§5.2) | Draft → `PUBLISHED` (`published_at/by`); previous `PUBLISHED` → `RETIRED` (`retired_at`); `current_version_id` moves |
| New version | Template has a published version; no draft exists | Clone of the current version as `DRAFT` vN+1 (revision 1, source `WEB`) |
| Discard draft | A draft exists | Draft deleted. If the template was never published, the template is deleted too |
| Rename | — | `name` and/or `category` updated |
| Disable | Template has a published version; not disabled | `disabled_at` set |
| Enable | Template disabled | `disabled_at` cleared |

All actions that touch more than one row run in one transaction. Publish locks the
template row (`SELECT … FOR UPDATE`) so two concurrent publishes cannot both retire
the same version; the partial unique indexes are the backstop.

A **disabled** template refuses new submissions and task-checklist requests (§6.4).
Existing submissions remain viewable and reviewable. Its draft may still be edited but
not published.

**Tabs** on the list screen:

- **Enabled** — `current_version_id IS NOT NULL AND disabled_at IS NULL`
- **Draft Box** — has a `DRAFT` version (a template can appear here and in Enabled)
- **Disabled** — `disabled_at IS NOT NULL`

---

## 5. Contracts (`@ipms/contracts`, `qc/qc.ts`)

### 5.1 The template document

One document shape is the unit of both the web editor and Excel import:

```ts
TemplateItemInput = {
  number: string (1–30, trimmed)
  requirementText: string (1–5000, trimmed)
  severity: 'NORMAL' | 'CRITICAL'           // default NORMAL
  responseType: ResponseType               // default RESULT_ONLY
  selectOptions: string[]                  // default []
  minPhotos: int 0–20                      // default 0
  maxPhotos: int 0–20                      // default 0
  allowsNa: boolean                        // default false
  isRequired: boolean                      // default true
  guidanceText?: string (≤ 2000)
}
TemplateSectionInput = { number: string (1–30), title: string (1–300), items: TemplateItemInput[] }
TemplateDocument = { sections: TemplateSectionInput[] }
```

Order is array position; there is no `order` field on input.

### 5.2 Validation

**Save rules** (`TemplateDocumentSchema` — applied to every save and every import):

- `maxPhotos >= minPhotos`
- `responseType = SELECT` ⇒ 2–50 options, each 1–100 characters, unique
  case-insensitively, none containing `;` (the Excel separator)
- `responseType ≠ SELECT` ⇒ `selectOptions` is empty
- Section numbers unique within the document; item numbers unique within their section
- At most 100 sections and 1,000 items in total

**Publish rules** (`PublishableDocumentSchema` — save rules plus):

- At least one section; every section has at least one item

Import applies the publish rules too: an imported workbook is expected to be a complete
checklist.

Errors carry a path (`sections.2.items.4.maxPhotos`) so the editor can mark the field.

### 5.3 Request schemas

```ts
CreateTemplateSchema   = { code: /^[A-Z0-9_-]+$/ (1–50), name (1–250), category }
UpdateTemplateSchema   = { name?, category? }            // at least one
SaveDraftSchema        = { revision: int ≥ 1, document: TemplateDocumentSchema }
ImportCommitSchema     = { code, name, category, document: PublishableDocumentSchema,
                           expectedDraftRevision?: int } // required when replacing a draft
ListTemplatesQuery     = { tab: 'enabled' | 'draft' | 'disabled' (default enabled),
                           category?, q? (≤ 100) }
CreateSubmissionSchema = existing, with templateId replaced by templateVersionId
```

`CreateTemplateSchema` loses `projectId` and `sections`: creation makes an empty draft.

---

## 6. `qc` service

### 6.1 Routes

| Method & path | Permission | Returns |
|---|---|---|
| `GET /qc/templates?tab&category&q` | `qc_template.view` | List entries (§6.2) |
| `GET /qc/templates/:id` | `qc_template.view` | Template + versions (number, status, source, published/retired at/by) |
| `GET /qc/templates/:id/versions/:version` | `qc_template.view` | Version with full section/item tree |
| `POST /qc/templates` | `qc_template.create` | Template + draft |
| `PATCH /qc/templates/:id` | `qc_template.update` | Template |
| `POST /qc/templates/:id/draft` | `qc_template.update` | New draft (clone of current) |
| `PUT /qc/templates/:id/draft` | `qc_template.update` | Saved draft with new revision |
| `DELETE /qc/templates/:id/draft` | `qc_template.update` | `{ templateDeleted }` — true when a never-published template went with its draft |
| `POST /qc/templates/:id/publish` | `qc_template.publish` | Published version |
| `POST /qc/templates/:id/disable` | `qc_template.publish` | Template |
| `POST /qc/templates/:id/enable` | `qc_template.publish` | Template |
| `GET /qc/templates/import/blank` | `qc_template.view` | .xlsx |
| `GET /qc/templates/:id/versions/:version/export` | `qc_template.view` | .xlsx |
| `POST /qc/templates/import/preview` (multipart `file`) | `qc_template.import` | Preview (§7.4) |
| `POST /qc/templates/import/commit` | `qc_template.import` | Template + draft |
| `GET /qc/tasks/:taskId/checklist` | authenticated; see §6.4 | Current published version tree + template metadata |

Route order in the controller puts `import/*` before `:id` routes.

### 6.2 List entry

```
{ id, code, name, category, disabledAt,
  current: { version, publishedAt, publishedBy, sectionCount, itemCount, criticalCount } | null,
  draft:   { version, revision, updatedAt, source } | null }
```

Sorted by code. `q` matches code or name, case-insensitive substring. Counts are
computed in SQL, not by loading trees.

### 6.3 Errors

| Condition | Status | Message |
|---|---|---|
| Schema violation | 422 | `VALIDATION_FAILED`, `details` keyed by dotted path (the platform's `GlobalExceptionFilter`) |
| Code already exists | 409 | "A template with code X already exists" |
| Stale draft revision | 409 | "Someone else saved this draft. Reload to see their changes." |
| No draft to save/publish/discard | 409 | "This template has no draft" |
| Draft already exists (new version) | 409 | "A draft (vN) already exists" |
| Publish while disabled | 409 | "Enable this template before publishing" |
| Publish validation fails | 422 | As above; the service throws the `ZodError` so the filter renders it |
| Unknown template/version | 404 | — |

### 6.4 The task checklist endpoint

`GET /qc/tasks/:taskId/checklist` is how a field engineer obtains the checklist for a
task assigned to them (T8). It carries no `@RequirePermission`; it authorizes itself:

1. Look up the task through the new `TaskLookupClient`, calling
   `project` `GET /internal/tasks/:id` directly at `PROJECT_INTERNAL_URL` with the
   caller's own `Authorization` header — the same pattern as `SiteGeofenceClient`, no
   shared service secret.
2. Allow if `task.assigneeId === caller.id`, or the caller holds `qc_template.view`
   (managers previewing what the engineer will see). Otherwise 403.
3. Task has no `templateId` → 404 "This task has no checklist assigned".
   Template disabled → 409 "This checklist has been disabled". Template never
   published → 409 "This checklist has not been published yet".
4. Return the template metadata and its **current published version** tree.

If `project` is unreachable or answers 404/403, the endpoint answers the same status
(503 for unreachable). Unlike the geofence lookup this cannot degrade gracefully: without
the task there is no authorization decision.

**`project` addition:** `GET /internal/tasks/:id` → `{ id, projectId, siteId,
assigneeId, templateId, status }`, `@RequirePermission('task.view')`. Field engineers
hold `task.view`.

### 6.5 Submissions

`createSubmission` resolves `templateVersionId` and accepts it if the template is not
disabled and the version is either `PUBLISHED`, or `RETIRED` with
`retired_at > now() − QC_RETIRED_VERSION_GRACE_DAYS` (env, default `7`). Otherwise
409 "This checklist has been updated. Refresh to get the latest version." The
existing response checks (every required item once, N/A allowance, photo counts)
are unchanged; the photo check uses `min_photos`/`max_photos` only.

No other submission behaviour changes in this sub-project.

### 6.6 Audit events

Lifecycle actions emit `SUBJECTS.AUDIT_EVENT` with `objectType: 'ChecklistTemplate'`,
written to a transactional outbox inside the action's transaction:

| Action | `action` | previous → new state |
|---|---|---|
| Create | `qc_template.created` | `{}` → `{code, name, category}` |
| Rename | `qc_template.updated` | changed fields before → after |
| Publish | `qc_template.published` | `{version: old}` → `{version: new}` |
| Discard | `qc_template.draft_discarded` | `{version}` → `{}` |
| Disable / Enable | `qc_template.disabled` / `.enabled` | `{disabledAt}` before → after |
| Import commit | `qc_template.imported` | `{}` or `{draftVersion}` → `{draftVersion, source: 'EXCEL_IMPORT'}` |

Draft saves are not audited; publish is the moment content becomes authoritative.

This adds to `qc`: an `outbox_event` table, an outbox drainer, and the `@ipms/events`
dependency and NATS configuration — copied from `iam`'s implementation
(`apps/iam/src/outbox/`) rather than generalized now. Sub-project 3 reuses them for
`qc.submission.*`.

---

## 7. Excel format

### 7.1 Workbook

Three sheets, identical for the blank download, exports and imports.

**`Template`** — two columns, *Field* and *Value*: `Code`, `Name`, `Category`
(`Quality` / `EHS` / `Other`). Exports append `Version`, `Status`, `Published At`, which
import ignores.

**`Checklist`** — one row per item, in display order:

| Column | Required | Values |
|---|---|---|
| Section No | on a section's first row | text |
| Section Title | on a section's first row | text |
| Item No | yes | text |
| Requirement | yes | text |
| Severity | no (Normal) | Normal, Critical |
| Response Type | no (Result only) | Result only, Text, Number, Yes/No, Select |
| Options | Select only | `;`-separated |
| Min Photos | no (0) | 0–20 |
| Max Photos | no (0) | 0–20 |
| Allow N/A | no (No) | Yes, No |
| Required | no (Yes) | Yes, No |
| Guidance | no | text |

**`Instructions`** — a plain-language description of every column and value.

Severity, Response Type, Allow N/A and Required carry Excel data validation dropdowns.

### 7.2 Section continuation

A row with Section No filled starts a section (Section Title required with it). A row
with both blank continues the previous section. Repeating the same number and title on
every row is equivalent. A section number that reappears with a different title is an
error; one that reappears after a different section is an error ("sections must be
contiguous"). The first data row must start a section.

### 7.3 Parsing

- Headers matched case-insensitively and ignoring surrounding whitespace; unknown
  columns ignored; a missing required column (Item No, Requirement, Section No,
  Section Title) is a file-level error.
- Values lenient: case-insensitive; `Yes/No`, `Y/N`, `True/False`, `1/0` for booleans;
  `Yes/No` and `Boolean` both map to `BOOLEAN`; blank cells take the defaults above.
- Fully blank rows are skipped.
- Limits: `.xlsx` only, 5 MB, 1,000 item rows.
- The parser produces a `TemplateDocument` and a list of errors
  `{ row, column, message }`; the document is then validated with
  `PublishableDocumentSchema`, whose path errors are mapped back to row and column.
- Written with `exceljs`, structured like `apps/project/src/project/import/`
  (`workbook.ts` reads, `parse.ts` maps rows, `template.ts` builds workbooks).

### 7.4 Preview and commit

`POST /qc/templates/import/preview` writes nothing and returns:

```
{ metadata: { code, name, category },
  target: { kind: 'NEW' } | { kind: 'EXISTING', templateId, name, category,
            replacesDraft: { version, revision } | null, nextVersion },
  warnings: string[],        // e.g. name/category differ from the existing template
  errors: { row, column, message }[],
  document: TemplateDocument | null,     // null when errors is non-empty
  summary: { sections, items, critical, withPhotos } | null }
```

`POST /qc/templates/import/commit` takes the previewed metadata and document back
(`ImportCommitSchema`), re-validates, and:

- **New code** → creates the template with a v1 draft, source `EXCEL_IMPORT`.
- **Existing code** → creates or replaces that template's draft with the document,
  source `EXCEL_IMPORT`. Name and category in the file are ignored (preview warned).
  Replacing a draft requires `expectedDraftRevision` to match; otherwise 409.

Nothing is written unless the whole document is valid.

### 7.5 Round-trip

Exporting a version and importing the file unchanged yields a document equal to the
version's content. This is a test (§10).

---

## 8. IAM seed

In `apps/iam/prisma/seed.ts`, which reconciles system role permissions on every run:

- **PROJECT_MANAGER** — remove `qc_template.create`, `qc_template.update`,
  `qc_template.publish`, `qc_template.import`. Keep `qc_template.view` (they pick
  templates for tasks).
- **FIELD_ENGINEER** — remove `qc_template.view`.
- **QC_MANAGER** and **SUPER_ADMIN** — unchanged; they hold every `qc_template`
  permission.

The role descriptions stay accurate: QC Manager "owns checklist templates".

---

## 9. Web

### 9.1 API wrapper

`apps/web/app/lib/qc-api.ts` is rewritten for the new routes and shapes, following
`project-api.ts`: request shapes are type-only imports from contracts, response types
are written as the wire sees them. The stale quarantine comment is removed. Excel
downloads go through a route handler under `app/api/qc/…` that streams the upstream
response, as the site import template download does.

### 9.2 Navigation

The sidebar's **Quality** item becomes **Quality & EHS**, linking to
`/quality/templates`, shown when the viewer holds `qc_template.view`. Work Orders and
Audit are added by their sub-projects.

### 9.3 Screens

**`/quality/templates`** — tabs Enabled / Draft Box / Disabled (`?tab=`), category
filter, search (`?q=`). Columns: Code, Name, Category, Version, Items (critical count),
Last published. Draft Box shows draft version and last saved instead. Actions:
*New template*, *Import from Excel*, *Download blank workbook*.

**`/quality/templates/new`** — code, name, category. On success, redirects to the
draft editor.

**`/quality/templates/import`** — file upload → preview. Errors render as a table of
row, column, message. A clean preview shows the target (new template, or "becomes v5
of AI-RRU-INST", with a replace-draft warning when applicable), warnings, and the
summary. *Confirm import* commits and redirects to the draft editor.

**`/quality/templates/[id]`** — header with code, name, category, status badges
(Enabled / Disabled / Draft vN). The current version rendered read-only: collapsible
sections; each item shows number, requirement, and badges for *Critical*, response
type, photos (*1–3 photos*, *optional up to 3*), *N/A allowed*, *Optional*; guidance
beneath. Version history: version, status, source, published by/at, *View*, *Export*.
Actions: *New version* or *Continue draft*, *Rename*, *Disable* / *Enable*, *Export*.

**`/quality/templates/[id]/versions/[version]`** — the same read-only rendering for
any version.

**`/quality/templates/[id]/draft`** — the editor (§9.4).

Write actions render only when the viewer holds the corresponding permission; the
server enforces it regardless.

### 9.4 Draft editor

A client component holding the document in a reducer; the server page loads the draft
and passes it in with its revision.

- Sections: add, remove, move up/down, edit number and title. Items within a section:
  add, remove, move up/down, and edit every field. Options input shown only for
  Select (one option per line in a textarea, split on newlines).
- New sections and items get the next number automatically (`3`, `3.1`, `3.2`).
  *Renumber* rewrites all numbers from position (`1`, `1.1`, `1.2`, `2`, `2.1`, …).
- *Save* calls a server action with `{revision, document}`. On success the new
  revision replaces the old. On 422, each error path marks its field and a summary
  lists them. On 409 (stale revision) a banner offers *Reload*.
- *Publish* saves first; if that succeeds, a confirmation dialog states "vN will be
  used by all projects from now on; vN−1 retires", then publishes and redirects to
  the detail page.
- *Discard draft* confirms, then deletes. For a never-published template the dialog
  says the template itself will be deleted.
- A `beforeunload` warning while there are unsaved changes.

The reducer is a pure module (`editor-state.ts`) so it is unit-tested without a DOM.

---

## 10. Testing

**Contracts**
- `TemplateDocumentSchema`: photo bounds, Select option rules, number uniqueness,
  limits, error paths.
- `PublishableDocumentSchema`: empty document, empty section.

**`qc` unit**
- Excel parser: section continuation, repeated section cells, non-contiguous and
  conflicting sections, lenient values, defaults, blank rows, missing columns, limits,
  row/column mapping of schema errors.
- Round-trip: export → parse equals the source document, for a version exercising
  every response type and field.
- Task checklist authorization with a stubbed `TaskLookupClient`: assignee, holder of
  `qc_template.view`, other user, task without template, disabled, unpublished,
  project unreachable.

**`qc` integration** (real Postgres, existing container setup)
- Partial unique indexes: a second draft and a second published version are refused.
- Publish retires the previous version and moves `current_version_id`.
- Stale revision → 409; concurrent publish leaves exactly one `PUBLISHED`.
- Discard of a never-published template deletes it.
- Disable blocks publish, submissions and task checklist; enable restores.
- Submission against the published version, against a version retired within the
  grace window, and against one retired before it.
- Import commit: new template; replace draft with matching and stale revision.
- Outbox: each lifecycle action writes exactly one audit event in its transaction.

**`project`**
- `GET /internal/tasks/:id`: shape, 404, permission.

**IAM**
- Seed: Project Manager lacks `qc_template` write permissions; Field Engineer lacks
  `qc_template.view`.

**Web**
- `qc-api` wrapper and server actions specs, following the existing pattern.
- `editor-state` reducer: add, remove, move, renumber, Select options.
- Manual browser verification of every screen, including the error and conflict paths.

**End-to-end**
- Create → edit → save → publish → export → import the export → new draft → publish;
  the detail page shows v2 current and v1 retired.

---

## 11. Known limitations carried forward

1. Submission endpoints are not scope-filtered and do not check the task assignee.
   Sub-project 3 adds both; scope filtering needs the replicated scope projection.
2. `Task.templateId` in `project` is not validated against `qc`. Sub-project 2 adds
   write-time validation when it adds template selection to tasks.
3. Template authorization is permission-only (T7). A QC Manager with a project-scoped
   role assignment can still change the library. Revisit when scope is replicated to
   `qc`.
4. Sample pictures are absent (T10).

---

## 12. Order of work

1. Contracts: document schemas, request schemas, updated submission schema.
2. `qc` schema and migration; service lifecycle; routes; errors.
3. `qc` outbox, drainer and audit events.
4. Excel: workbook builder, parser, preview/commit, blank and export downloads.
5. `project` internal task endpoint; `qc` task checklist endpoint.
6. Submission changes (version reference, grace window).
7. IAM seed changes.
8. Web: API wrapper, navigation, list, create, detail, version view.
9. Web: import screens.
10. Web: draft editor.
11. End-to-end test and manual verification.
