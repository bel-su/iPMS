# iPMS — Bulk Site Import and Site Geofencing Design

**Status:** Approved
**Date:** 2026-09-20
**Parent spec:** `2026-09-15-ipms-microservices-architecture-design.md` §7.1, §9.2
**Related spec:** `2026-09-20-project-crud-design.md` (adds the site forms this design extends)

---

## 1. Context

Sites reach the system one at a time. A rollout that starts with four hundred tower
sites in a client's spreadsheet has to be retyped into the web form four hundred
times, and each retyping is a chance to transpose a site code.

Separately, the system has no way to tell whether a field engineer was actually at a
site when they filed the work. The data model has been ready for this since the
foundation: `Site` already carries `latitude`, `longitude` and `geofenceRadiusM`, and
`CreateSiteSchema`, `UpdateSiteSchema`, `createSite` and `updateSite` all read and
write them. Nothing surfaces them. `apps/web/app/projects/forms.tsx` has no
coordinate fields at all, so every site in the database has null coordinates and the
default 100 m radius, and no submission records where it was filed from.

This design closes both gaps, because they share a column: an import is the only
practical way to get four hundred pairs of coordinates into the system, and
coordinates are what make the proximity check possible.

### 1.1 Scope

**In:** bulk site import from Excel (template download, preview, commit); a
project-level default geofence radius with a per-site override or opt-out;
coordinates and geofence controls in the web site and project forms; GPS fields on
the QC submission contract; the synchronous site lookup that lets the QC service
record a submission's distance from its site; the new `site.import` permission.

**Out:** the Flutter field client and its offline, at-capture proximity warning — this
design provides the effective radius in the task sync payload that such a client would
read, and nothing more. The QC reviewer UI (see §7.4). Photo-level geofence distance
on `ItemPhoto`, which the parent spec §9.2 assigns to the unbuilt `media` service.
Bulk import of anything other than sites.

### 1.2 Relationship to the parent spec's geofence decision

The parent spec, §9.2, already ruled on geofencing:

> Photos beyond the site's `geofence_radius_m` are flagged for reviewer attention —
> flagged, not rejected, because GPS in dense urban and hilly terrain is imperfect and
> the reviewer is the right judge.

This design does not overturn that. It applies the same reasoning one level up, at the
submission rather than the photo: **an out-of-range submission is recorded and flagged,
never blocked.** A bad GPS fix, a basement equipment room, or an urban canyon must
never strand an engineer who is genuinely on site with no way to file their work.

Where this design goes beyond the parent spec is the *optional* part. §9.2 assumes
every site has a meaningful radius. Linear works — a fiber run stretching kilometres
between splice points — have no single point to be near, so the check must be
switchable off without losing the coordinates themselves.

---

## 2. Data model

### 2.1 The tri-state problem

A site must express three distinct states:

1. inherit whatever the project's rule is,
2. use its own radius, regardless of the project, and
3. run no proximity check at all, even though the project has a radius.

A single nullable integer cannot carry three states — `null` can mean "inherit" or
"off" but not both. Encoding "off" as radius `0` was rejected: a zero radius literally
reads as *must be exactly at the point*, the opposite of the intent, and sentinel
values invite exactly that misreading at the call site that matters.

So the mode is explicit:

```prisma
model Project {
  // ...
  defaultGeofenceRadiusM Int? @default(500) @map("default_geofence_radius_m")
}

model Site {
  // ...
  geofenceMode    String @default("INHERIT") @db.VarChar(10)  // INHERIT | CUSTOM | OFF
  geofenceRadiusM Int?   @map("geofence_radius_m")            // set only when CUSTOM
}
```

`Project.defaultGeofenceRadiusM` is itself nullable, and `null` there means the project
runs no proximity checks. A fiber project sets it to `null` once and every site
imported into it inherits that, with no per-row column to fill in.

### 2.2 Resolution

One pure function, `resolveGeofenceRadius`, in the new `libs/geo`:

| `site.geofenceMode` | Effective radius |
|---|---|
| `OFF` | `null` |
| `CUSTOM` | `site.geofenceRadiusM` |
| `INHERIT` | `project.defaultGeofenceRadiusM` (may itself be `null`) |

**`null` means no proximity check.** Every consumer treats it that way; there is no
second "enabled" flag to fall out of sync with the radius.

A `CUSTOM` mode with a null `geofenceRadiusM` is invalid and is rejected by the
contract schema (§3.1), not left to resolve to `null` by accident.

### 2.3 Migration

`Site.geofenceRadiusM` is today `Int @default(100)` and non-null. The migration:

1. adds `Project.default_geofence_radius_m`, nullable, default 500;
2. adds `Site.geofence_mode`, default `'INHERIT'`;
3. makes `Site.geofence_radius_m` nullable;
4. **backfills every existing site to `geofence_mode = 'CUSTOM'`**, keeping its current
   radius.

Step 4 is the point. Existing sites keep their 100 m behaviour exactly rather than
being silently re-pointed at the new 500 m project default. Only sites created after
this migration inherit.

### 2.4 QC submission

`Submission` gains four columns:

```prisma
model Submission {
  // ...
  latitude          Decimal? @db.Decimal(10,7)
  longitude         Decimal? @db.Decimal(10,7)
  distanceFromSiteM Int?     @map("distance_from_site_m")
  geofenceStatus    String   @default("NOT_APPLICABLE") @db.VarChar(20)
}
```

`geofenceStatus` has five values, each meaning something different to a reviewer:

| Status | Meaning |
|---|---|
| `INSIDE` | Device GPS was within the effective radius |
| `OUTSIDE` | Device GPS was outside it — `distanceFromSiteM` says by how far |
| `NO_FIX` | Submission carried no coordinates; the device had no GPS lock |
| `NOT_APPLICABLE` | Site has no coordinates, or its effective radius is `null` |
| `UNVERIFIED` | The project service could not be reached; see §6.2 |

`NO_FIX` and `NOT_APPLICABLE` are deliberately distinct: the first is a device that
could not answer, the second is a question that was never asked. A reviewer chasing a
suspicious submission needs to tell those apart.

---

## 3. Contracts

### 3.1 Changed schemas

`CreateProjectSchema` / `UpdateProjectSchema` gain:

```ts
defaultGeofenceRadiusM: z.number().int().positive().max(100_000).nullable().optional()
```

`CreateSiteSchema` / `UpdateSiteSchema` replace the flat `geofenceRadiusM` with the
mode plus radius, refined so the pair cannot be incoherent:

```ts
geofenceMode: z.enum(['INHERIT', 'CUSTOM', 'OFF']).optional(),
geofenceRadiusM: z.number().int().positive().max(100_000).nullable().optional(),
// .refine: geofenceMode === 'CUSTOM' requires a non-null geofenceRadiusM
```

`CreateSubmissionSchema` gains optional coordinates:

```ts
latitude: z.number().gte(-90).lte(90).optional(),
longitude: z.number().gte(-180).lte(180).optional(),
```

Both optional, and **independently so** — a device with no fix sends neither, and the
server records `NO_FIX` rather than rejecting the submission. This is the one place
the lat/lng pairing rule of §4.2 does not apply, because rejecting an unpaired
coordinate here would block a submission, which §1.2 forbids.

### 3.2 New schemas

`SiteImportRowSchema`, `SiteImportPreviewResponseSchema` and `SiteImportCommitSchema`,
covering the shapes in §4.

### 3.3 New library: `libs/geo`

Two pure functions, no dependencies, no I/O:

- `haversineMeters(a: Coordinates, b: Coordinates): number`
- `resolveGeofenceRadius(site, project): number | null`

They live in their own library rather than inside `ProjectService` or `QcService`
because both services need them, they are the part of this design most worth testing
exhaustively, and they are testable with no database and no HTTP. `libs/geo` follows
the existing pattern of small focused libraries — `authz`, `contracts`, `events`,
`observability`, `persistence`.

---

## 4. Excel import

### 4.1 Three endpoints

```
GET  /projects/:id/sites/import/template   → .xlsx: headers, one example row,
                                              a note of the project's default radius
POST /projects/:id/sites/import/preview    → multipart file in; per-row report out;
                                              WRITES NOTHING
POST /projects/:id/sites/import/commit     → normalised rows as JSON; one transaction
```

**The server keeps no import session state.** Preview returns the rows it parsed and
normalised; the client echoes those rows back to commit. There is no server-side cache
keyed by an import token to expire, leak, or collide.

Commit re-validates every row from scratch — file-level uniqueness, field validity,
and which site codes now exist in the database. A commit containing any row that fails
that revalidation is **rejected whole**, with the same per-row error report the preview
returns; it does not silently drop the row. **The preview is advisory UX, not a
trusted handoff.** A client that tampers with the echoed rows can only produce a
different set of fully-validated writes, which is exactly the authority that client
already holds through the ordinary create and update endpoints.

The split also makes the two halves independently testable: parsing and validation is
a pure function over a workbook with no HTTP or database, and commit is a database
operation over plain JSON with no Excel involved.

### 4.2 Columns

Header row matched case-insensitively and order-independently, so a client's own
column order survives:

| Column | Required | Rule |
|---|---|---|
| `site_code` | ✓ | `[A-Z0-9_-]+`, ≤50 chars, unique within the file after trim and uppercase |
| `name` | ✓ | ≤200 chars |
| `region` | | ≤150 chars; region upserted by name within the project |
| `latitude` | | −90 to 90 |
| `longitude` | | −180 to 180 |
| `geofence` | | blank = `INHERIT` · `off` (any case) = `OFF` · a positive integer = `CUSTOM` at that radius in metres |
| `address` | | ≤500 chars |
| `city` | | ≤100 chars |
| `area` | | ≤100 chars |
| `scope_variant` | | ≤100 chars |
| `status` | | `PLANNED` (default), `IN_DELIVERY`, `COMPLETED`, `BLOCKED` |

**A row with exactly one of `latitude`/`longitude` is invalid.** A lone coordinate is
always a data-entry error, and accepting it would produce a site that looks located
but can never be measured against.

**A missing column and a blank cell mean different things**, and the distinction
matters on `UPDATE` rows:

- A column **absent from the header row** is not touched on any row. A manager can
  export just `site_code`, `latitude`, `longitude` to correct coordinates, and no
  address or region is disturbed.
- A **blank cell in a column that is present** clears that field. Within the columns it
  declares, the spreadsheet is authoritative — and the preview diff shows the clear
  (`region: North → (none)`) before anything is committed.

This rule applies uniformly to every optional column, including `geofence`: a blank
cell in a present `geofence` column sets the site back to `INHERIT`.

Limits: **2,000 rows and 5 MB per file.** The row cap is a consequence of the
all-or-nothing commit in §4.4 — Prisma has no bulk update for rows with differing
values, so an update-heavy import becomes that many individual statements inside one
transaction. 2,000 keeps a single transaction within a sane timeout. A larger rollout
splits across files, which is also how a client's own regional spreadsheets usually
arrive.

### 4.3 Preview report

Per row: `{ rowNumber, action, siteCode, changes?, errors? }` where `action` is
`CREATE`, `UPDATE` or `INVALID`, plus a summary of the three counts.

**`UPDATE` rows carry a field-level diff** — `latitude: 27.7172 → 27.7180` — not just
a count. A manager re-uploading a corrected file needs to see precisely what will be
overwritten on the rows they did not intend to touch, before they confirm.

`INVALID` rows carry every error found on that row, not just the first, so one
round-trip surfaces everything wrong with the file.

### 4.4 Commit

A site code that already exists in the project is **updated**, and the preview said so.
This is what makes the fix-and-re-upload loop work: a manager corrects six rows in the
same 300-row file and re-sends the whole thing, rather than deleting the 294 good rows
to avoid duplicate-code errors. `(projectId, siteCode)` is already unique, so the match
is unambiguous.

Commit is **all-or-nothing** in one `prisma.$transaction`: either the spreadsheet is
the project's site list or nothing changed. There is no partially-imported project to
reconcile.

Order within the transaction:

1. Resolve and upsert the distinct region names (deduplicated first, so a 300-row file
   with four regions does four upserts, not three hundred).
2. `createMany` for the `CREATE` rows.
3. Individual `update` calls for the `UPDATE` rows.

### 4.5 Library

**`exceljs`**, for both parsing uploads and generating the template. Pure JavaScript
with no native dependencies, and actively maintained — unlike the npm-published build
of SheetJS, whose maintained releases moved off npm.

---

## 5. Permissions

One new permission, mirroring the existing `qc_template.import`:

```ts
def('site', 'import', 'Bulk-import sites from Excel', ['site.view', 'site.create', 'site.update'])
```

It depends on `site.update`, not just `site.create`, **because the import can overwrite
existing sites** (§4.4). Nobody gains bulk-overwrite authority they do not already hold
one site at a time.

In `apps/iam/prisma/seed.ts` this is added to `SUPER_ADMIN` (which takes `ALL`
automatically) and to `PROJECT_MANAGER`.

`QC_MANAGER` does **not** receive it. That role holds `site.view` only and does not
create or edit sites; giving it bulk import would be the single largest expansion of
its authority in the catalogue, and site provisioning is a project-management concern.

---

## 6. Proximity at submission

### 6.1 Internal endpoint

The QC service gets site coordinates synchronously at write time, matching the parent
spec §8's rule that cross-service references "are validated synchronously at write
time and never joined on afterwards".

```
GET /internal/sites/:id/geofence → { latitude, longitude, effectiveRadiusM }
```

It is served by the project service under `/internal/`, which
`apps/gateway/src/proxy/routes.ts` already refuses to route from any client — the
existing convention for service-to-service endpoints. The project service resolves the
effective radius with `resolveGeofenceRadius` (§2.2) so the resolution rule lives in
exactly one place.

### 6.2 Recording

In `createSubmission`, after the existing validation. The table is **ordered by
precedence and evaluated first-match** — a site with no geofence configured records
`NOT_APPLICABLE` even when the device also sent no fix, because "we were not checking"
is the more useful answer to a reviewer than "the device could not say":

| Condition | Result |
|---|---|
| Project service unreachable or errors | `UNVERIFIED`, distance `null` |
| Site has no coordinates, or `effectiveRadiusM` is `null` | `NOT_APPLICABLE`, distance `null` |
| Submission carried no coordinates | `NO_FIX`, distance `null` |
| Otherwise | `haversineMeters` → distance; `INSIDE` if ≤ radius, else `OUTSIDE` |

**This path never throws.** Every failure mode degrades to a recorded status. A
submission represents work an engineer actually did in the field; losing it to a
geofence lookup that timed out would be a far worse outcome than not knowing where it
was filed from. `UNVERIFIED` exists precisely so that "we could not check" is a
recorded fact rather than an indistinguishable `NOT_APPLICABLE`.

### 6.3 What is not here

The engineer's own "you are 1.2 km from this site" warning is **not** in this design.
It has to fire at capture time, on a device that may be offline for hours before it
syncs, so it belongs in the Flutter client using site coordinates it already holds
locally. What this design provides for it is the effective radius in the task sync
payload. Until that client exists, no user sees a proximity warning at capture time.

---

## 7. Web

### 7.1 Site form

`apps/web/app/projects/forms.tsx` gains latitude, longitude, and a geofence control
offering Inherit (showing the project's current default inline), Custom with a radius
input, and Off. These fields exist today in the database, the contracts and the
service, and are absent only from the form — this closes that gap for single-site
entry as well as import.

### 7.2 Project form

Gains the default geofence radius, with an explicit "no proximity checks on this
project" option for linear works.

### 7.3 Import screen

`apps/web/app/projects/[id]/sites/import/` — template download link, file picker,
then the preview table with its new/updated/invalid summary, per-row errors, and
field-level diffs on update rows, and a confirm button that calls commit.

### 7.4 Known gap: no reviewer UI

There is no QC reviewer UI in the web app. `apps/web/app/lib/qc-api.ts` exists with
passing tests and no page consumes it. So the distance and geofence status will be
stored and returned by the API, and **nothing will display them to a reviewer** when
this work lands.

This is stated rather than quietly designed around. Building the reviewer screen is
its own piece of work with its own spec; folding a first QC page into this design would
widen it past the point where a single plan is reviewable.

---

## 8. Testing

| Area | Approach |
|---|---|
| `libs/geo` | Unit. Haversine against known coordinate pairs including antimeridian and equator crossings; `resolveGeofenceRadius` across all three modes × a null and non-null project default |
| Import parsing | Unit, over fixture workbooks: valid file, unpaired coordinate, duplicate code in file, bad enum, over-length string, missing required header, empty file, over-cap row count |
| Import commit | Integration against real Postgres, following the existing pattern: all-or-nothing rollback on a mid-file failure, region deduplication, create/update mix |
| Permissions | The existing `validatePermissionSet` covers dependency closure; seed integration test asserts `PROJECT_MANAGER` has `site.import` and `QC_MANAGER` does not |
| Submission geofence | Unit with the internal lookup stubbed, one test per row of the §6.2 table — including the unreachable-service case asserting the submission still persists |
| Migration | Integration: a pre-migration site at 100 m resolves to 100 m afterwards, not 500 |

---

## 9. Decisions

| Decision | Rationale |
|---|---|
| Warn and record, never block | Parent spec §9.2's reasoning, applied at the submission. GPS fails indoors and in urban canyons; blocking a real engineer at a real site is worse than flagging one who is not |
| Explicit `geofenceMode` over a sentinel radius | Three states need three states. Radius `0` reads as "exactly at the point", the opposite of "no check" |
| Project default, site override | A fiber project switches the rule off once; a mixed project still has per-site control |
| 500 m default, on | Proximity is the norm and linear works are the exception, so fiber opts out rather than every tower project opting in |
| Preview echoes rows to commit | No server-side import session to expire or leak; commit re-validates regardless |
| All-or-nothing commit | No partially-imported project to reconcile against the spreadsheet |
| Existing site codes update | Makes fix-and-re-upload work without editing the file down to just the corrections |
| 2,000-row cap | Consequence of all-or-nothing plus Prisma's lack of differing-value bulk update |
| `site.import` depends on `site.update` | The import overwrites; bulk authority should not exceed single-record authority |
| Synchronous internal lookup | Parent spec §8's existing rule for cross-service references; no new projection table or staleness window |
| Geofence lookup never throws | A submission is field work already done. Losing it to a lookup failure is the worst available outcome |
