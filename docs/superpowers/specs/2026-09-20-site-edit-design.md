# iPMS — Editing a Site Design

**Status:** Approved
**Date:** 2026-09-20
**Parent spec:** `2026-09-15-ipms-microservices-architecture-design.md` §7.1
**Related specs:** `2026-09-20-project-crud-design.md` (the site forms this extends),
`2026-09-20-site-bulk-import-and-geofence-design.md` (added the coordinate and geofence fields)

---

## 1. Context

A site can be created, imported and deleted. It cannot be edited.

Everything below the web app is already in place. `UpdateSiteSchema` is in
`@ipms/contracts`, `ProjectService.updateSite` writes every field it carries,
`PATCH /api/v1/sites/:id` is declared in the controller behind `site.update`, the
gateway proxies the `/api/v1/sites` prefix, `site.update` is a defined permission with
`site.view` as its dependency, and `apps/web/app/lib/project-api.ts` exports an
`updateSite` wrapper. `updateSiteAction` is even written in
`apps/web/app/projects/actions.ts`. Nothing calls it: no component imports it and no
test covers it.

So the only route to correcting a site today is delete-and-recreate, which loses the
site's id and every task hanging off it, or a second Excel import, which is a heavy
instrument for fixing one transposed coordinate.

### 1.1 Scope

**In:** a per-row Edit affordance on the project page's sites table; a dedicated edit
page; the fields that table already shows, plus status; making `null` mean "clear this
value" on a site update, for the fields where a wrong value must be removable rather
than merely overwritten.

**Out:** editing `siteCode` (see §3.1). The `address`, `area` and `scopeVariant`
columns, which the service and the import write but no web form has ever shown —
exposing them is its own decision, not a side effect of this one. A site detail page.
Bulk editing. Any change to how the import upserts.

---

## 2. Entry point and route

A new page:

```
apps/web/app/projects/[id]/sites/[siteId]/edit/page.tsx
```

reached from an **Edit** link in each row of the sites table on
`apps/web/app/projects/[id]/page.tsx`. The link sits to the left of the existing Delete
button inside the same `row-actions` cell — the `.data-table .row-actions > * + *`
rule in `styles.css` already spaces siblings — and renders only when the viewer holds
`site.update`, the same way Delete is gated on `site.delete`. As elsewhere on that page,
the gate is for clarity; the gateway and the service guards are what enforce it.

The page is a server component shaped like `apps/web/app/projects/[id]/edit/page.tsx`:
the same `StatePage` branches for an unauthenticated viewer and an unreadable project,
plus two of its own.

| Condition | Response |
|---|---|
| Not signed in | `StatePage` with a sign-in link |
| Project unreadable | `StatePage`, the API's message, a link back to `/projects` |
| `siteId` not among the project's sites | `StatePage` "Cannot edit this site", a link back to the project |
| Viewer lacks `site.update` | `StatePage` "You cannot edit sites", a link back to the project |
| Otherwise | The edit form |

The `site.update` branch matters because the row link is only a hint: a bookmarked or
shared URL would otherwise render a form whose every submission 403s.

### 2.1 Reading the site

There is no `GET /api/v1/sites/:id`. The page calls the existing `getProject(id)` and
finds the site in `data.sites`, which `ProjectService.getProject` already returns with
its region included.

This is not merely a workaround. The same response carries the project's
`defaultGeofenceRadiusM`, which lets the geofence dropdown name what inheriting
actually means for this project — "Use the project default (500 m)", or "(no check)"
when the project has none — instead of the create form's blind "Use the project
default". Adding a per-site endpoint would cost that context back.

### 2.2 After a successful save

The action redirects to `/projects/{projectId}#sites`, the anchor of the sites panel, so
the user lands on the row they just changed.

This differs from `updateProjectAction`, which stays on its edit page. That is a
deliberate departure rather than an inconsistency: `FormState` carries an error and
nothing else, so a save that stays put produces no visible acknowledgement at all. The
updated row is the acknowledgement.

---

## 3. Fields

The form covers exactly what the sites table shows, plus status.

| Field | Control | Notes |
|---|---|---|
| Site code | Read-only input | Hint: "Fixed at creation", as the project code carries |
| Name | Text, required | |
| Region | Text | Free text; the service upserts a `Region` by name within the project |
| City | Text | |
| Latitude / Longitude | Number, `step="any"` | Bounded −90…90 and −180…180 |
| Geofence mode | Select | Inherit / Custom / Off; the Inherit label names the project's radius |
| Radius (m) | Number | Required when the mode is Custom |
| Status | Select | `PLANNED`, `IN_DELIVERY`, `COMPLETED`, `BLOCKED` |

### 3.1 Why the site code is read-only

The service would accept it — `updateSite` handles `siteCode` and turns a unique
violation into "Site code is already in use in this project". The refusal is
behavioural, not technical: the Excel import matches an existing site by
`projectId + siteCode`. A site renamed through this form no longer matches its row in
the client's spreadsheet, so the next import creates a duplicate rather than updating
it, and the site's history silently splits in two. The project code is read-only on the
project edit page for the same kind of reason, and this form says so the same way.

---

## 4. Clearing a value

`optional()` in `apps/web/app/projects/settle.ts` maps an empty input to `undefined`,
and a `PATCH` reads an absent field as "leave this alone". On a create form that is
right. On an edit form it means emptying a field does nothing at all — a wrong
coordinate or a misfiled region could be overwritten but never removed, and the form
would look broken while behaving as designed.

`null` becomes the way a caller says "clear this".

### 4.1 Contracts

In `libs/contracts/src/project/project.ts`, `latitude`, `longitude`, `regionName` and
`city` are lifted out of the `SiteFields` literal into named schemas, so that their
bounds are written once. `SiteFields` uses them as-is; `UpdateSiteSchema` re-declares
those four in its existing `.extend(...)` as `.nullable().optional()`.

Nullable on update only, never on create — creating a site with an explicitly null city
says nothing that omitting it does not. This is the treatment `UpdateTaskSchema`
already gives `assigneeId`, and the reasoning in its comment applies unchanged: absent
means leave it alone, null means remove it, and a form needs both.

### 4.2 The coordinate pair

A second `.refine`, alongside `customNeedsRadius`:

> If either coordinate appears in the payload, both must appear, and both must be null
> or both must be numbers.

Without it a caller could null latitude alone and leave longitude behind, and a site
with half a coordinate is a site the haversine distance in `@ipms/geo` cannot use.
Because zod omits absent keys from a parsed object, `'latitude' in value` distinguishes
"not sent" from "sent as null" reliably.

This is the rule `parseCoordinates` in `apps/project/src/project/import/parse.ts`
already applies to every imported row — *"latitude and longitude must be given
together, or both left blank"* — moved to where both paths can share it.

### 4.3 Service

One change, in `ProjectService.updateSite`. `regionId` widens from
`string | undefined` to `string | null | undefined`, and `dto.regionName === null`
sets it to `null` rather than falling through to the upsert. The existing
`...(regionId === undefined ? {} : { regionId })` spread then carries the null through
unchanged.

No other field needs touching: each already spreads as
`...(dto.x === undefined ? {} : { x: dto.x })`, which passes null to Prisma verbatim,
and `latitude`, `longitude`, `regionId` and `city` are all nullable columns already.

---

## 5. The action

`updateSiteAction` exists but drops `regionName` and `city` on the floor and treats a
blank coordinate as "unchanged". It gains:

- **`clearable(form, field)`**, a sibling of `optional` in `settle.ts`: the field absent
  from the `FormData` yields `{}`, present but blank yields `{ [field]: null }`,
  otherwise `{ [field]: trimmed }`. Absence and blankness are different answers, which
  is the whole point, so it cannot be built on `optional`.
- **`siteGeofenceFields(form, blank)`**, where `blank` is `'ignore'` for create — today's
  behaviour, unchanged — or `'clear'` for update, which turns two empty coordinate
  inputs into `{ latitude: null, longitude: null }`. The lone-coordinate check and the
  custom-needs-radius check stay shared; only the meaning of blank differs.
- **A required-name guard**, so a blank name is answered immediately rather than
  silently ignored.
- **The redirect** of §2.2, after `settle` and only when it reports no error, in the
  shape `createProjectAction` already uses.

`createSiteAction` is unaffected beyond passing `'ignore'` to the renamed helper.

---

## 6. Tests

| Where | What |
|---|---|
| `libs/contracts/src/project/project.spec.ts` | `UpdateSiteSchema` accepts null for the four clearable fields; rejects one coordinate sent without the other; rejects one nulled while the other is a number; still rejects `CUSTOM` without a radius; `CreateSiteSchema` still rejects null for those fields |
| `apps/project/src/project/project.service.spec.ts` | `updateSite` with `regionName: null` writes `regionId: null` and performs no region upsert |
| `apps/web/app/projects/actions.spec.ts` | `updateSiteAction` sends null for a blank clearable field, omits a field absent from the form, refuses a lone coordinate before calling the API, refuses a blank name, and redirects to the project page on success |

The web action tests follow the file's existing shape: `next/cache` and
`next/navigation` mocked at the top, `../lib/project-api` mocked wholesale, the module
imported after the mocks are registered.

---

## 7. What this does not change

The import's upsert, the geofence resolution in `@ipms/geo`, the QC service's site
lookup, and the create-site form's behaviour are all untouched. The one contract change
is additive: a field that was optional becomes optional-or-null on update, which no
existing caller can notice.
