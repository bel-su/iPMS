# iPMS — Work Order Management Design

**Status:** Implemented
**Date:** 2026-09-24
**Parent spec:** `2026-09-22-qc-template-management-design.md` §1 (sub-project 2)

## 1. Scope

Assigning published QC checklist templates to sites as **work orders**, and listing them.

**In:** work order creation (type, template, planned completion date, site, responsible
person, generated name) with a live checklist preview and continuous creation; a
paginated list with per-status tabs and search; write-time validation of the template
(closes QC spec §11 limitation 2); a name directory for assignment pickers.

**Out:** `qc.submission.*` → task status sync (work orders stay `NOT_STARTED` until
it lands); work order detail/edit/cancel screens; "Responsible Company" and "DU"
(no data model yet); validating that the assignee holds scope on the site.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| W1 | A work order is a `project` `Task` with `workOrderType` set | Field engineer lists, qc's task checklist lookup and dashboard counts see it unchanged |
| W2 | `Task.taskTypeId` becomes nullable | The design picks a template, not a project task type; a work order credits no milestone |
| W3 | `templateName` is snapshotted on the task | The list renders without a cross-service join; qc owns templates |
| W4 | `project` validates the template through qc `GET /internal/templates/:id`, forwarding the caller's token | Same pattern as qc's `TaskLookupClient`; no shared secret |
| W5 | Type ↔ category: `QUALITY_*` needs a `QUALITY` template, `EHS_*` an `EHS` one | A Quality check on an EHS checklist is meaningless |
| W6 | Creating needs `task.create` **and** `task.assign` | A work order is created already assigned |
| W7 | iam `GET /users/directory` (id, name, employee code, active), gated by `task.view` | QC Managers raise spot checks but lack `user.view`; the response is deliberately narrower than `/users` |

## 3. API

| Route | Permission | Notes |
|---|---|---|
| `POST /projects/:id/work-orders` | `task.create` + `task.assign` | 400 bad site/template/category · 409 disabled or unpublished template · 503 qc unreachable |
| `GET /projects/:id/work-orders?status&workOrderType&q&page&limit` | `task.view` | `{ items (with site), total, page, limit, counts }`; counts ignore `status`, honour `q` |
| qc `GET /internal/templates/:id` | `qc_template.view` | `{ id, code, name, category, disabled, publishedVersion }`; unreachable through the gateway |
| iam `GET /users/directory` | `task.view` | Includes inactive users, so old assignees keep a name |

`project` reads `QC_INTERNAL_URL` (default `http://qc:3005`).

## 4. Web

- Project tab **Work orders** (`/projects/[id]/work-orders`): tabs All / Completed /
  Ongoing / Not Started / Reviewing / Rectifying / Cancelled with counts, search,
  pagination; columns per the design.
- **Create** (`…/work-orders/new`): form left, preview right. The template list is
  filtered by the type's category; the name is `[Type label]Site name` plus optional
  text; the date means end of that day in the creator's time zone. With continuous
  creation on, a submit keeps type/template/date and clears site/person.
- Sidebar **Work orders** → `/quality/work-orders`, a project picker.
- Task tables show the work order type where there is no task type, and assignee names.
