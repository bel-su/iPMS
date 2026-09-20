# Bulk Site Import and Site Geofencing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins and project managers create sites in bulk from an Excel file, and record how far each QC submission was filed from its site — with the proximity check switchable off per site or per project.

**Architecture:** A new pure `libs/geo` holds the haversine and the radius-resolution rule so both the project and QC services share one implementation. The project service gains a three-endpoint import flow (template → preview → commit) where preview writes nothing and commit re-validates from scratch, plus an `/internal/` endpoint the QC service calls synchronously at submission time. The QC service records a distance and a five-state status, and never throws from that path.

**Tech Stack:** Nx + pnpm workspace, NestJS 12 on Fastify, Prisma 7 / PostgreSQL, Zod contracts, Next.js App Router with Server Actions, Vitest, `exceljs` 4.4.0, `@fastify/multipart` 10.1.1.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-20-site-bulk-import-and-geofence-design.md`. Every decision below traces to it.
- **Never block a submission on geofencing.** Every failure mode in the proximity path degrades to a recorded status. Spec §1.2, §6.2.
- **`null` effective radius means "no proximity check."** There is no separate enabled flag. Spec §2.2.
- **New Prisma columns are quoted camelCase with no `@map`.** The init migration wrote `"geofenceRadiusM"`, `"scopeVariant"`, `"siteCode"` that way. The spec's snippets showed `@map("geofence_radius_m")` illustratively; using it would rename a live column.
- **Migrations are hand-written SQL**, one statement per line, in `apps/<service>/prisma/migrations/<timestamp>_<name>/migration.sql`. Do not run `prisma migrate dev` — it would rewrite the existing history.
- **Row cap: 2,000. File cap: 5 MB.** Spec §4.2.
- **TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.** An optional property must be spread conditionally (`...(x === undefined ? {} : { x })`), never assigned `undefined`.
- Commit after each task. Run `pnpm --filter <package> test` before each commit.

---

### Task 1: `libs/geo` — haversine and radius resolution

Two pure functions with no I/O, in their own library because both services need them and they are the part of this work most worth testing exhaustively.

**Files:**
- Create: `libs/geo/package.json`, `libs/geo/tsconfig.json`, `libs/geo/tsconfig.build.json`, `libs/geo/vitest.config.ts`
- Create: `libs/geo/src/index.ts`, `libs/geo/src/haversine.ts`, `libs/geo/src/geofence.ts`
- Test: `libs/geo/src/haversine.spec.ts`, `libs/geo/src/geofence.spec.ts`
- Modify: `tsconfig.base.json` (add the `@ipms/geo` path)

**Interfaces:**
- Consumes: nothing.
- Produces: `haversineMeters(a: Coordinates, b: Coordinates): number` · `resolveGeofenceRadius(site: GeofenceSite, project: GeofenceProject): number | null` · types `Coordinates { latitude: number; longitude: number }`, `GeofenceMode = 'INHERIT' | 'CUSTOM' | 'OFF'`, `GeofenceSite { geofenceMode: GeofenceMode; geofenceRadiusM: number | null }`, `GeofenceProject { defaultGeofenceRadiusM: number | null }`.

- [ ] **Step 1: Scaffold the package**

`libs/geo/package.json` — note there are **no dependencies**; that is the point of this library.

```json
{
  "name": "@ipms/geo",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`libs/geo/tsconfig.json` — copied from `libs/persistence/tsconfig.json`, including the empty `paths` override and the comment explaining it:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    // Sibling libs resolve through node_modules to their built `exports`, not
    // through the workspace path aliases. The aliases point at `.ts` sources,
    // which would pull another lib's source into this lib's program and nest
    // the emitted output under an extra directory level.
    "paths": {}
  },
  "include": ["src/**/*.ts"]
}
```

`libs/geo/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.spec.ts"]
}
```

`libs/geo/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: false, environment: 'node' } });
```

In `tsconfig.base.json`, add to `compilerOptions.paths`:

```json
      "@ipms/geo": ["libs/geo/src/index.ts"],
```

- [ ] **Step 2: Write the failing tests**

`libs/geo/src/haversine.spec.ts` — bounds rather than exact equality, so a correct implementation using a slightly different Earth radius still passes:

```ts
import { describe, expect, it } from 'vitest';
import { haversineMeters } from './haversine.js';

/** One degree of arc on the mean-radius sphere is ~111,195 m. */
const ONE_DEGREE_MIN = 111_150;
const ONE_DEGREE_MAX = 111_240;

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ latitude: 27.7172, longitude: 85.324 }, { latitude: 27.7172, longitude: 85.324 })).toBe(0);
  });

  it('measures one degree of longitude at the equator', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(d).toBeGreaterThanOrEqual(ONE_DEGREE_MIN);
    expect(d).toBeLessThanOrEqual(ONE_DEGREE_MAX);
  });

  it('measures one degree of latitude', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThanOrEqual(ONE_DEGREE_MIN);
    expect(d).toBeLessThanOrEqual(ONE_DEGREE_MAX);
  });

  it('measures a ~500 m step north', () => {
    const d = haversineMeters({ latitude: 27.7172, longitude: 85.324 }, { latitude: 27.7217, longitude: 85.324 });
    expect(d).toBeGreaterThanOrEqual(498);
    expect(d).toBeLessThanOrEqual(502);
  });

  // The short way round, not 359 degrees the long way. A site near the
  // antimeridian must not read as a third of the planet away.
  it('crosses the antimeridian the short way', () => {
    const d = haversineMeters({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 });
    expect(d).toBeGreaterThanOrEqual(ONE_DEGREE_MIN);
    expect(d).toBeLessThanOrEqual(ONE_DEGREE_MAX);
  });

  it('is symmetric', () => {
    const a = { latitude: 27.7172, longitude: 85.324 };
    const b = { latitude: 28.2096, longitude: 83.9856 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });
});
```

`libs/geo/src/geofence.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveGeofenceRadius } from './geofence.js';

describe('resolveGeofenceRadius', () => {
  it('returns null for an OFF site even when the project has a default', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'OFF', geofenceRadiusM: 250 }, { defaultGeofenceRadiusM: 500 })).toBeNull();
  });

  it('returns the site radius for a CUSTOM site', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }, { defaultGeofenceRadiusM: 500 })).toBe(250);
  });

  it('returns the project default for an INHERIT site', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'INHERIT', geofenceRadiusM: null }, { defaultGeofenceRadiusM: 500 })).toBe(500);
  });

  it('returns null for an INHERIT site when the project runs no checks', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'INHERIT', geofenceRadiusM: null }, { defaultGeofenceRadiusM: null })).toBeNull();
  });

  // Rejected by the contract schema, so it cannot be persisted — but the
  // resolver is also reached from the internal endpoint reading rows written
  // before that schema existed, and "no check" is the safe reading.
  it('returns null for a CUSTOM site with no radius', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'CUSTOM', geofenceRadiusM: null }, { defaultGeofenceRadiusM: 500 })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
pnpm --filter @ipms/geo test
```

Expected: FAIL — `Failed to resolve import "./haversine.js"` and `"./geofence.js"`.

- [ ] **Step 4: Implement**

`libs/geo/src/haversine.ts`:

```ts
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** IUGG mean Earth radius. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres, rounded to the nearest metre.
 *
 * A spherical model is ~0.5% off an ellipsoidal one, which is an order of
 * magnitude inside the error of the handset GPS fix this is ever compared
 * against. Sub-metre precision here would be false precision.
 *
 * `Math.min(1, …)` guards the `asin` domain: for two points a few centimetres
 * apart, floating-point error can push the square root a hair above 1 and
 * produce NaN.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}
```

`libs/geo/src/geofence.ts`:

```ts
export type GeofenceMode = 'INHERIT' | 'CUSTOM' | 'OFF';

export interface GeofenceSite {
  geofenceMode: GeofenceMode;
  geofenceRadiusM: number | null;
}

export interface GeofenceProject {
  defaultGeofenceRadiusM: number | null;
}

/**
 * The effective proximity radius for a site in metres, or `null` for no check.
 *
 * `null` is the single representation of "do not check". There is deliberately
 * no second enabled flag that could disagree with the radius.
 */
export function resolveGeofenceRadius(site: GeofenceSite, project: GeofenceProject): number | null {
  if (site.geofenceMode === 'OFF') return null;
  if (site.geofenceMode === 'CUSTOM') return site.geofenceRadiusM;
  return project.defaultGeofenceRadiusM;
}
```

`libs/geo/src/index.ts`:

```ts
export { haversineMeters, type Coordinates } from './haversine.js';
export {
  resolveGeofenceRadius,
  type GeofenceMode, type GeofenceProject, type GeofenceSite,
} from './geofence.js';
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
pnpm install && pnpm --filter @ipms/geo test && pnpm --filter @ipms/geo build
```

Expected: 11 passing, and `libs/geo/dist/index.js` written.

- [ ] **Step 6: Commit**

```bash
git add libs/geo tsconfig.base.json pnpm-lock.yaml
git commit -m "feat(geo): haversine distance and geofence radius resolution

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The `site.import` permission

Must land before any endpoint that declares it, or `AuthzGuard` will refuse a code it cannot find in the catalogue.

**Files:**
- Modify: `libs/authz/src/permissions.ts:44` (after the `site.delete` line)
- Modify: `apps/iam/prisma/seed.ts:20` (the `PROJECT_MANAGER` permission list)
- Test: `libs/authz/src/permissions.spec.ts`, `apps/iam/prisma/seed.integration.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the permission code `'site.import'`, usable as `@RequirePermission('site.import')`.

- [ ] **Step 1: Write the failing tests**

Append to `libs/authz/src/permissions.spec.ts`:

```ts
describe('site.import', () => {
  it('is in the catalogue', () => {
    expect(PERMISSION_CODES.has('site.import')).toBe(true);
  });

  // It overwrites existing sites, so bulk authority must not exceed the
  // one-at-a-time authority the holder already has.
  it('depends on site.update, not only site.create', () => {
    expect(expandDependencies(['site.import'])).toEqual(
      expect.arrayContaining(['site.view', 'site.create', 'site.update', 'project.view']),
    );
  });
});
```

Append to `apps/iam/prisma/seed.integration.spec.ts`:

```ts
it('gives PROJECT_MANAGER site.import but not QC_MANAGER', async () => {
  const roles = await prisma.role.findMany({
    where: { code: { in: ['PROJECT_MANAGER', 'QC_MANAGER'] } },
    include: { permissions: { include: { permission: true } } },
  });
  const codes = (code: string): string[] =>
    roles.find((role) => role.code === code)?.permissions.map((entry) => entry.permission.code) ?? [];
  expect(codes('PROJECT_MANAGER')).toContain('site.import');
  expect(codes('QC_MANAGER')).not.toContain('site.import');
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @ipms/authz test
```

Expected: FAIL — `expect(false).toBe(true)` on the catalogue test.

- [ ] **Step 3: Add the permission**

In `libs/authz/src/permissions.ts`, directly after the `def('site', 'delete', …)` line:

```ts
  def('site', 'import', 'Bulk-import sites from Excel', ['site.view', 'site.create', 'site.update']),
```

In `apps/iam/prisma/seed.ts`, in the `PROJECT_MANAGER` permission array, replace the site line:

```ts
      'site.view', 'site.create', 'site.update', 'site.import',
```

Leave `QC_MANAGER` untouched — it holds `site.view` only and does not provision sites.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @ipms/authz test
```

Expected: PASS. The existing `validatePermissionSet` dependency-closure test also still passes, because the seed closes each role's set over its dependencies before insert.

- [ ] **Step 5: Commit**

```bash
git add libs/authz/src/permissions.ts libs/authz/src/permissions.spec.ts apps/iam/prisma/seed.ts apps/iam/prisma/seed.integration.spec.ts
git commit -m "feat(authz): add site.import permission

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Project service migration — project default, site mode, nullable radius

**Files:**
- Modify: `apps/project/prisma/schema.prisma` (the `Project` and `Site` models)
- Create: `apps/project/prisma/migrations/20260921000100_site_geofence_mode/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `Project.defaultGeofenceRadiusM: number | null`, `Site.geofenceMode: string`, `Site.geofenceRadiusM: number | null` on the generated `@prisma-clients/project` types.

- [ ] **Step 1: Write the migration**

`apps/project/prisma/migrations/20260921000100_site_geofence_mode/migration.sql` — one statement per line, matching the style of the init migration:

```sql
ALTER TABLE "project" ADD COLUMN "defaultGeofenceRadiusM" integer DEFAULT 500;
ALTER TABLE "site" ADD COLUMN "geofenceMode" varchar(10) NOT NULL DEFAULT 'INHERIT';
UPDATE "site" SET "geofenceMode" = 'CUSTOM';
ALTER TABLE "site" ALTER COLUMN "geofenceRadiusM" DROP NOT NULL;
ALTER TABLE "site" ALTER COLUMN "geofenceRadiusM" DROP DEFAULT;
```

The `UPDATE` is the point of this migration. It pins every pre-existing site to `CUSTOM` at the 100 m it already had, so none of them silently jumps to the new 500 m project default. Only sites created after this migration inherit.

- [ ] **Step 2: Update the schema**

In `apps/project/prisma/schema.prisma`, in `model Project`, after the `status` line:

```prisma
  defaultGeofenceRadiusM Int? @default(500)
```

In `model Site`, replace the `geofenceRadiusM Int @default(100)` line with:

```prisma
  geofenceMode String @default("INHERIT") @db.VarChar(10)
  geofenceRadiusM Int?
```

No `@map` on either — the column names are already the quoted camelCase the SQL above creates.

- [ ] **Step 3: Apply and regenerate**

```bash
pnpm --filter project exec prisma migrate deploy && pnpm --filter project prisma:generate
```

Expected: `1 migration found`, `Applied migration 20260921000100_site_geofence_mode`, then `Generated Prisma Client`.

- [ ] **Step 4: Verify the backfill against a real database**

```bash
psql "$PROJECT_DATABASE_URL" -c "SELECT \"geofenceMode\", \"geofenceRadiusM\", count(*) FROM site GROUP BY 1, 2;"
```

Expected: every pre-existing row reads `CUSTOM | 100`. If the table was empty, zero rows — which is also correct.

- [ ] **Step 5: Commit**

```bash
git add apps/project/prisma
git commit -m "feat(project): per-site geofence mode and project default radius

Existing sites are pinned to CUSTOM at their current radius so none of
them silently adopts the new 500 m project default.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Contracts — geofence fields on project and site

**Files:**
- Modify: `libs/contracts/src/project/project.ts:9-33`
- Test: `libs/contracts/src/project/project.spec.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `CreateProjectSchema`/`UpdateProjectSchema` accepting `defaultGeofenceRadiusM: number | null | undefined`; `CreateSiteSchema`/`UpdateSiteSchema` accepting `geofenceMode: 'INHERIT' | 'CUSTOM' | 'OFF'` and `geofenceRadiusM: number | null | undefined`, refined so `CUSTOM` requires a radius. `GeofenceModeSchema` exported for reuse.

- [ ] **Step 1: Write the failing tests**

`libs/contracts/src/project/project.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CreateSiteSchema, CreateProjectSchema } from './project.js';

const site = { siteCode: 'SITE_01', name: 'Site One' };

describe('CreateSiteSchema geofence', () => {
  it('defaults to INHERIT when no mode is given', () => {
    expect(CreateSiteSchema.parse(site).geofenceMode).toBe('INHERIT');
  });

  it('accepts OFF with no radius', () => {
    expect(CreateSiteSchema.parse({ ...site, geofenceMode: 'OFF' }).geofenceMode).toBe('OFF');
  });

  it('accepts CUSTOM with a radius', () => {
    expect(CreateSiteSchema.parse({ ...site, geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }).geofenceRadiusM).toBe(250);
  });

  // The invalid state the resolver would otherwise have to guess at.
  it('rejects CUSTOM with no radius', () => {
    expect(CreateSiteSchema.safeParse({ ...site, geofenceMode: 'CUSTOM' }).success).toBe(false);
  });

  it('rejects a negative radius', () => {
    expect(CreateSiteSchema.safeParse({ ...site, geofenceMode: 'CUSTOM', geofenceRadiusM: -1 }).success).toBe(false);
  });
});

describe('CreateProjectSchema geofence', () => {
  it('accepts an explicit null default, meaning no checks on this project', () => {
    expect(CreateProjectSchema.parse({ code: 'P1', name: 'P', defaultGeofenceRadiusM: null }).defaultGeofenceRadiusM).toBeNull();
  });

  it('accepts a radius', () => {
    expect(CreateProjectSchema.parse({ code: 'P1', name: 'P', defaultGeofenceRadiusM: 500 }).defaultGeofenceRadiusM).toBe(500);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @ipms/contracts test
```

Expected: FAIL — `expect(undefined).toBe('INHERIT')`, and the `CUSTOM`-with-no-radius case wrongly succeeds.

- [ ] **Step 3: Implement**

In `libs/contracts/src/project/project.ts`, after the `MilestoneKindSchema` line:

```ts
export const GeofenceModeSchema = z.enum(['INHERIT', 'CUSTOM', 'OFF']);
export const GeofenceRadiusSchema = z.number().int().positive().max(100_000);
```

Add to the `CreateProjectSchema` object literal, before the closing `}).strip()`:

```ts
  defaultGeofenceRadiusM: GeofenceRadiusSchema.nullable().optional(),
```

Replace the whole `CreateSiteSchema` / `UpdateSiteSchema` region. A `.refine` returns a `ZodEffects`, which has no `.omit`/`.partial`, so the object must be kept as a named base and the refinement applied to each derived schema separately:

```ts
/** The site fields as a plain object, so both schemas below can derive from it. */
const SiteFields = z.object({
  siteCode: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  regionName: z.string().trim().min(1).max(150).optional(),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  geofenceMode: GeofenceModeSchema.default('INHERIT'),
  geofenceRadiusM: GeofenceRadiusSchema.nullable().optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  scopeVariant: z.string().max(100).optional(),
});

/** A CUSTOM site with no radius would resolve to "no check", which is the opposite of what CUSTOM means. */
// The explicit `| undefined`s are required: under exactOptionalPropertyTypes
// an `x?: string` parameter accepts an absent key but NOT an explicit
// undefined, so the refined object's own type would not be assignable.
const customNeedsRadius = (value: { geofenceMode?: string | undefined; geofenceRadiusM?: number | null | undefined }): boolean =>
  value.geofenceMode !== 'CUSTOM' || (value.geofenceRadiusM !== null && value.geofenceRadiusM !== undefined);

const CUSTOM_RADIUS_MESSAGE = { message: 'A custom geofence needs a radius in metres', path: ['geofenceRadiusM'] };

export const CreateSiteSchema = SiteFields.strip().refine(customNeedsRadius, CUSTOM_RADIUS_MESSAGE);
export type CreateSiteDto = z.infer<typeof CreateSiteSchema>;

export const UpdateSiteSchema = SiteFields
  .partial()
  .extend({ status: SiteStatusSchema.optional() })
  .strip()
  .refine(customNeedsRadius, CUSTOM_RADIUS_MESSAGE);
export type UpdateSiteDto = z.infer<typeof UpdateSiteSchema>;
```

`.partial()` on the base also makes `geofenceMode` optional on updates, which is what an update wants: omitting it leaves the site's current mode alone, and `updateSite` already spreads it conditionally.

Add to `UpdateProjectSchema`'s `.extend({ … })`:

```ts
  defaultGeofenceRadiusM: GeofenceRadiusSchema.nullable().optional(),
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @ipms/contracts test && pnpm --filter @ipms/contracts build
```

Expected: PASS, including the existing project contract tests.

- [ ] **Step 5: Commit**

```bash
git add libs/contracts/src/project
git commit -m "feat(contracts): geofence mode on site, default radius on project

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: ProjectService writes the geofence fields

**Files:**
- Modify: `apps/project/src/project/project.service.ts` (`createProject`, `updateProject`, `createSite`, `updateSite`)
- Test: `apps/project/src/project/project.service.spec.ts`

**Interfaces:**
- Consumes: `CreateSiteDto`, `UpdateSiteDto`, `CreateProjectDto`, `UpdateProjectDto` from Task 4.
- Produces: no new signatures — the existing methods now persist the geofence fields.

- [ ] **Step 1: Write the failing tests**

Append to `apps/project/src/project/project.service.spec.ts`. That file already defines `makePrisma()` (a hand-written Prisma double) and `service(prisma)`; use them rather than introducing a second fake.

```ts
describe('createSite geofence', () => {
  it('stores the mode and radius', async () => {
    const prisma = makePrisma();
    await service(prisma).createSite('p-1', {
      siteCode: 'S1', name: 'One', geofenceMode: 'CUSTOM', geofenceRadiusM: 250,
    } as never);
    expect(prisma.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }),
    });
  });

  it('defaults an unspecified site to INHERIT with a null radius', async () => {
    const prisma = makePrisma();
    await service(prisma).createSite('p-1', { siteCode: 'S1', name: 'One', geofenceMode: 'INHERIT' } as never);
    expect(prisma.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ geofenceMode: 'INHERIT', geofenceRadiusM: null }),
    });
  });
});

describe('createProject geofence default', () => {
  it('defaults to 500 m', async () => {
    const prisma = makePrisma();
    await service(prisma).createProject({ code: 'P1', name: 'P' } as never);
    expect(prisma.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ defaultGeofenceRadiusM: 500 }) });
  });

  // An explicit null means "no checks on this project" and must survive.
  it('keeps an explicit null', async () => {
    const prisma = makePrisma();
    await service(prisma).createProject({ code: 'P1', name: 'P', defaultGeofenceRadiusM: null } as never);
    expect(prisma.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ defaultGeofenceRadiusM: null }) });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter project test
```

Expected: FAIL — the created row has no `geofenceMode`.

- [ ] **Step 3: Implement**

In `createSite`, inside the `this.prisma.site.create({ data: { … } })` literal, replace `geofenceRadiusM: dto.geofenceRadiusM ?? 100` with:

```ts
geofenceMode: dto.geofenceMode, geofenceRadiusM: dto.geofenceRadiusM ?? null,
```

In `updateSite`, in the conditional-spread `data` object, replace the `geofenceRadiusM` entry with:

```ts
...(dto.geofenceMode===undefined?{}:{geofenceMode:dto.geofenceMode}),...(dto.geofenceRadiusM===undefined?{}:{geofenceRadiusM:dto.geofenceRadiusM}),
```

In `createProject`, inside the `data` literal:

```ts
defaultGeofenceRadiusM: dto.defaultGeofenceRadiusM === undefined ? 500 : dto.defaultGeofenceRadiusM,
```

`=== undefined` rather than `??`, because an explicit `null` means "no checks on this project" and must not be replaced by the default.

In `updateProject`, in the conditional-spread `data` object:

```ts
...(dto.defaultGeofenceRadiusM===undefined?{}:{defaultGeofenceRadiusM:dto.defaultGeofenceRadiusM}),
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter project test
```

Expected: PASS, with the existing project service tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/project/src/project/project.service.ts apps/project/src/project/project.service.spec.ts
git commit -m "feat(project): persist geofence mode, radius and project default

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The internal geofence endpoint

The QC service reads this at submission time. It lives under `/internal/`, which `apps/gateway/src/proxy/routes.ts:115` already refuses to route, so it is unreachable from any client.

**Files:**
- Modify: `apps/project/src/project/project.service.ts` (add `siteGeofence`)
- Modify: `apps/project/src/project/project.controller.ts` (add the route)
- Modify: `apps/project/package.json` (add `@ipms/geo`)
- Test: `apps/project/src/project/project.service.spec.ts`, `apps/gateway/src/proxy/routes.spec.ts`

**Interfaces:**
- Consumes: `resolveGeofenceRadius` from Task 1; the schema columns from Task 3.
- Produces: `GET /internal/sites/:id/geofence` returning `{ latitude: number | null; longitude: number | null; effectiveRadiusM: number | null }`, and `ProjectService.siteGeofence(id: string): Promise<SiteGeofence>`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter project add @ipms/geo@workspace:*
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/project/src/project/project.service.spec.ts`:

```ts
describe('siteGeofence', () => {
  /** Coordinates arrive as Prisma Decimal, which serializes as a string. */
  const site = (over: Record<string, unknown> = {}) => ({
    id: 's-1', latitude: '27.7172000', longitude: '85.3240000',
    geofenceMode: 'INHERIT', geofenceRadiusM: null,
    project: { defaultGeofenceRadiusM: 500 }, ...over,
  });

  it('resolves an inheriting site to the project default', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site());
    expect(await service(prisma).siteGeofence('s-1')).toEqual({
      latitude: 27.7172, longitude: 85.324, effectiveRadiusM: 500,
    });
  });

  it('resolves an OFF site to no radius', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site({ geofenceMode: 'OFF' }));
    expect((await service(prisma).siteGeofence('s-1')).effectiveRadiusM).toBeNull();
  });

  it('resolves a CUSTOM site to its own radius', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }));
    expect((await service(prisma).siteGeofence('s-1')).effectiveRadiusM).toBe(250);
  });

  it('returns null coordinates for a site that has none', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site({ latitude: null, longitude: null }));
    const result = await service(prisma).siteGeofence('s-1');
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it('404s an unknown site', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(null);
    await expect(service(prisma).siteGeofence('s-1')).rejects.toThrow(NotFoundException);
  });
});
```

Append to `apps/gateway/src/proxy/routes.spec.ts`, inside the existing `describe('resolveUpstream — internal routes stay private')`:

```ts
it('refuses the site geofence lookup', () => {
  expect(resolveUpstream('/api/v1/internal/sites/abc/geofence')).toBeUndefined();
});
```

- [ ] **Step 3: Run and watch them fail**

```bash
pnpm --filter project test && pnpm --filter gateway test
```

Expected: project FAILs with `service.siteGeofence is not a function`. The gateway test should already PASS — the `/internal/` guard is prefix-independent, and this test pins that behaviour for the new path.

- [ ] **Step 4: Implement**

Add to the `ProjectService` import line: `import { resolveGeofenceRadius, type GeofenceMode } from '@ipms/geo';`

Add the method to `ProjectService`:

```ts
  /**
   * Coordinates and effective radius for one site, for the qc service.
   *
   * Decimal columns arrive as Prisma `Decimal`; they are narrowed to `number`
   * here so the caller never has to know which driver produced them.
   */
  async siteGeofence(id: string): Promise<{ latitude: number | null; longitude: number | null; effectiveRadiusM: number | null }> {
    const site = await this.prisma.site.findUnique({ where: { id }, include: { project: { select: { defaultGeofenceRadiusM: true } } } });
    if (!site) throw new NotFoundException('Site not found');
    return {
      latitude: site.latitude === null ? null : Number(site.latitude),
      longitude: site.longitude === null ? null : Number(site.longitude),
      effectiveRadiusM: resolveGeofenceRadius(
        { geofenceMode: site.geofenceMode as GeofenceMode, geofenceRadiusM: site.geofenceRadiusM },
        { defaultGeofenceRadiusM: site.project.defaultGeofenceRadiusM },
      ),
    };
  }
```

Add to `ProjectController`:

```ts
  /** Service-to-service only: the gateway refuses every '/internal/' path. Still permission-checked, because the caller forwards the submitting user's own token. */
  @Get('internal/sites/:id/geofence') @RequirePermission('site.view') siteGeofence(@Param('id') id:string){ return this.service.siteGeofence(UuidSchema.parse(id)); }
```

The `site.view` requirement is deliberate: the QC service forwards the submitting engineer's bearer token, and `FIELD_ENGINEER` already holds `site.view`. This needs no shared secret and no new service-identity mechanism.

- [ ] **Step 5: Run and watch them pass**

```bash
pnpm --filter project test && pnpm --filter gateway test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/project libs/geo pnpm-lock.yaml apps/gateway/src/proxy/routes.spec.ts
git commit -m "feat(project): internal site geofence lookup for qc

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Contracts — the import row, preview and commit shapes

**Files:**
- Create: `libs/contracts/src/project/site-import.ts`
- Modify: `libs/contracts/src/index.ts` (add the export)
- Test: `libs/contracts/src/project/site-import.spec.ts`

**Interfaces:**
- Consumes: `GeofenceModeSchema`, `SiteStatusSchema` from Task 4.
- Produces: `IMPORT_COLUMNS` (readonly tuple), `ImportColumn`, `SiteImportRowSchema`/`SiteImportRowDto`, `SiteImportCommitSchema`/`SiteImportCommitDto`, `SiteImportPreviewDto`, `SiteImportRowReport`, `IMPORT_ROW_LIMIT = 2000`, `IMPORT_FILE_BYTES = 5_242_880`.

- [ ] **Step 1: Write the failing test**

`libs/contracts/src/project/site-import.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IMPORT_ROW_LIMIT, SiteImportCommitSchema } from './site-import.js';

const row = { rowNumber: 2, siteCode: 'SITE_01', name: 'One' };

describe('SiteImportCommitSchema', () => {
  it('accepts a minimal commit', () => {
    const parsed = SiteImportCommitSchema.parse({ columns: ['site_code', 'name'], rows: [row] });
    expect(parsed.rows).toHaveLength(1);
  });

  it('rejects an empty commit', () => {
    expect(SiteImportCommitSchema.safeParse({ columns: ['site_code'], rows: [] }).success).toBe(false);
  });

  it('rejects more rows than the cap', () => {
    const rows = Array.from({ length: IMPORT_ROW_LIMIT + 1 }, (_, i) => ({ ...row, rowNumber: i + 2 }));
    expect(SiteImportCommitSchema.safeParse({ columns: ['site_code', 'name'], rows }).success).toBe(false);
  });

  it('rejects a column name that is not an import column', () => {
    expect(SiteImportCommitSchema.safeParse({ columns: ['nonsense'], rows: [row] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @ipms/contracts test
```

Expected: FAIL — cannot resolve `./site-import.js`.

- [ ] **Step 3: Implement**

`libs/contracts/src/project/site-import.ts`:

```ts
import { z } from 'zod';
import { GeofenceModeSchema, GeofenceRadiusSchema, SiteStatusSchema } from './project.js';

/**
 * Every column the importer understands, in template order.
 *
 * The list is also the contract for the missing-column rule: `columns` on a
 * commit says which columns the uploaded sheet actually declared, and any
 * column absent from it is left untouched on an update. A blank cell in a
 * column that IS present clears the field.
 */
export const IMPORT_COLUMNS = [
  'site_code', 'name', 'region', 'latitude', 'longitude', 'geofence',
  'address', 'city', 'area', 'scope_variant', 'status',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const IMPORT_ROW_LIMIT = 2000;
export const IMPORT_FILE_BYTES = 5_242_880;

export const SiteImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  siteCode: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  regionName: z.string().trim().max(150).nullable().optional(),
  latitude: z.number().gte(-90).lte(90).nullable().optional(),
  longitude: z.number().gte(-180).lte(180).nullable().optional(),
  geofenceMode: GeofenceModeSchema.optional(),
  geofenceRadiusM: GeofenceRadiusSchema.nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  area: z.string().trim().max(100).nullable().optional(),
  scopeVariant: z.string().trim().max(100).nullable().optional(),
  status: SiteStatusSchema.optional(),
}).strip();
export type SiteImportRowDto = z.infer<typeof SiteImportRowSchema>;

export const SiteImportCommitSchema = z.object({
  columns: z.array(z.enum(IMPORT_COLUMNS)).min(1),
  rows: z.array(SiteImportRowSchema).min(1).max(IMPORT_ROW_LIMIT),
}).strip();
export type SiteImportCommitDto = z.infer<typeof SiteImportCommitSchema>;

export type SiteImportAction = 'CREATE' | 'UPDATE' | 'INVALID';

export interface SiteImportFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface SiteImportRowReport {
  rowNumber: number;
  action: SiteImportAction;
  siteCode: string | null;
  errors: string[];
  /** Populated only for UPDATE rows: exactly what a commit would overwrite. */
  changes: SiteImportFieldChange[];
}

export interface SiteImportPreviewDto {
  columns: ImportColumn[];
  summary: { created: number; updated: number; invalid: number };
  rows: SiteImportRowReport[];
  /** The payload to POST to commit, or null when any row is invalid. */
  importable: SiteImportCommitDto | null;
}
```

Add to `libs/contracts/src/index.ts`, after the existing project export:

```ts
export * from './project/site-import.js';
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @ipms/contracts test && pnpm --filter @ipms/contracts build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/contracts/src
git commit -m "feat(contracts): site import row, commit and preview shapes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The Excel parser

Pure over a buffer: no database, no HTTP. This is where every validation rule in spec §4.2 lives.

**Files:**
- Create: `apps/project/src/project/import/workbook.ts`, `apps/project/src/project/import/parse.ts`
- Modify: `apps/project/package.json` (add `exceljs`)
- Test: `apps/project/src/project/import/parse.spec.ts`

**Interfaces:**
- Consumes: `IMPORT_COLUMNS`, `SiteImportRowDto`, `IMPORT_ROW_LIMIT` from Task 7.
- Produces: `readSheet(buffer: Buffer): Promise<SheetContents>` where `SheetContents = { columns: ImportColumn[]; unknownHeaders: string[]; rows: RawRow[] }` and `RawRow = { rowNumber: number; cells: Partial<Record<ImportColumn, string>> }`; `parseRows(sheet: SheetContents): ParsedRow[]` where `ParsedRow = { rowNumber: number; row: SiteImportRowDto | null; errors: string[] }`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter project add exceljs@4.4.0
```

- [ ] **Step 2: Write the failing tests**

`apps/project/src/project/import/parse.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ImportColumn } from '@ipms/contracts';
import { parseRows } from './parse.js';

const sheet = (columns: ImportColumn[], cells: Array<Partial<Record<ImportColumn, string>>>) => ({
  columns, unknownHeaders: [],
  rows: cells.map((value, index) => ({ rowNumber: index + 2, cells: value })),
});

const BASE: ImportColumn[] = ['site_code', 'name'];

describe('parseRows', () => {
  it('parses a minimal valid row', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: 'SITE_01', name: 'One' }]));
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.row).toMatchObject({ siteCode: 'SITE_01', name: 'One', rowNumber: 2 });
  });

  it('uppercases and trims a site code', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: '  site_01 ', name: 'One' }]));
    expect(parsed?.row?.siteCode).toBe('SITE_01');
  });

  it('reports a missing required field', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: 'SITE_01', name: '  ' }]));
    expect(parsed?.row).toBeNull();
    expect(parsed?.errors.join(' ')).toContain('name');
  });

  // A lone coordinate is always a data-entry error: the site would look
  // located but could never be measured against.
  it('rejects a latitude with no longitude', () => {
    const [parsed] = parseRows(sheet([...BASE, 'latitude', 'longitude'], [{ site_code: 'S1', name: 'One', latitude: '27.7' }]));
    expect(parsed?.errors.join(' ')).toContain('latitude and longitude');
  });

  it('rejects an out-of-range latitude', () => {
    const [parsed] = parseRows(sheet([...BASE, 'latitude', 'longitude'], [{ site_code: 'S1', name: 'One', latitude: '99', longitude: '85' }]));
    expect(parsed?.row).toBeNull();
  });

  it('reads a blank geofence cell as INHERIT', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: '' }]));
    expect(parsed?.row).toMatchObject({ geofenceMode: 'INHERIT', geofenceRadiusM: null });
  });

  it('reads "off" in any case as OFF', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: 'Off' }]));
    expect(parsed?.row).toMatchObject({ geofenceMode: 'OFF' });
  });

  it('reads a number as a custom radius', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: '250' }]));
    expect(parsed?.row).toMatchObject({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 });
  });

  it('rejects a geofence value that is neither off nor a number', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: 'maybe' }]));
    expect(parsed?.errors.join(' ')).toContain('geofence');
  });

  it('flags a duplicate site code within the file, on the later row', () => {
    const parsed = parseRows(sheet(BASE, [
      { site_code: 'SITE_01', name: 'One' },
      { site_code: 'site_01', name: 'Two' },
    ]));
    expect(parsed[0]?.errors).toEqual([]);
    expect(parsed[1]?.errors.join(' ')).toContain('appears more than once');
  });

  it('reads a blank cell in a present column as an explicit clear', () => {
    const [parsed] = parseRows(sheet([...BASE, 'city'], [{ site_code: 'S1', name: 'One', city: '' }]));
    expect(parsed?.row?.city).toBeNull();
  });

  // The other half of that rule: an absent column is not a clear.
  it('leaves a field undefined when its column is absent', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: 'S1', name: 'One' }]));
    expect(parsed?.row?.city).toBeUndefined();
  });

  it('collects every error on a row, not just the first', () => {
    const [parsed] = parseRows(sheet([...BASE, 'status'], [{ site_code: 'bad code!', name: '', status: 'NOPE' }]));
    expect(parsed?.errors.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm --filter project test
```

Expected: FAIL — cannot resolve `./parse.js`.

- [ ] **Step 4: Implement the parser**

`apps/project/src/project/import/parse.ts`:

```ts
import { IMPORT_COLUMNS, SiteImportRowSchema, type ImportColumn, type SiteImportRowDto } from '@ipms/contracts';

export interface RawRow {
  rowNumber: number;
  cells: Partial<Record<ImportColumn, string>>;
}

export interface SheetContents {
  columns: ImportColumn[];
  unknownHeaders: string[];
  rows: RawRow[];
}

export interface ParsedRow {
  rowNumber: number;
  row: SiteImportRowDto | null;
  errors: string[];
}

/**
 * A cell's three states, which the missing-column rule turns on.
 *
 * `undefined` — the column is not in the sheet, so the field is not touched.
 * `null`      — the column is present and the cell is blank: clear the field.
 * a string    — a value to parse.
 */
function cell(row: RawRow, columns: ImportColumn[], column: ImportColumn): string | null | undefined {
  if (!columns.includes(column)) return undefined;
  const raw = row.cells[column];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `{ field: value }` when the column is present, `{}` when it is absent. */
function optionalText(value: string | null | undefined): { value: string | null } | Record<string, never> {
  return value === undefined ? {} : { value };
}

function parseGeofence(value: string | null | undefined, errors: string[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null) return { geofenceMode: 'INHERIT', geofenceRadiusM: null };
  if (value.toLowerCase() === 'off') return { geofenceMode: 'OFF', geofenceRadiusM: null };
  const radius = Number(value);
  if (!Number.isInteger(radius) || radius <= 0) {
    errors.push(`geofence must be blank, "off", or a positive whole number of metres — got "${value}"`);
    return {};
  }
  return { geofenceMode: 'CUSTOM', geofenceRadiusM: radius };
}

function parseCoordinates(
  latitude: string | null | undefined,
  longitude: string | null | undefined,
  errors: string[],
): Record<string, unknown> {
  if (latitude === undefined && longitude === undefined) return {};
  const present = (value: string | null | undefined): boolean => typeof value === 'string';
  if (present(latitude) !== present(longitude)) {
    errors.push('latitude and longitude must be given together, or both left blank');
    return {};
  }
  if (!present(latitude)) return { latitude: null, longitude: null };
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    errors.push('latitude and longitude must be numbers');
    return {};
  }
  return { latitude: lat, longitude: lon };
}

/**
 * Validates every row and reports every problem on each, rather than stopping
 * at the first — one upload should surface everything wrong with the file.
 */
export function parseRows(sheet: SheetContents): ParsedRow[] {
  const seen = new Map<string, number>();
  return sheet.rows.map((raw) => {
    const errors: string[] = [];
    const siteCode = (cell(raw, sheet.columns, 'site_code') ?? '').toUpperCase();
    const candidate: Record<string, unknown> = {
      rowNumber: raw.rowNumber,
      siteCode,
      name: cell(raw, sheet.columns, 'name') ?? '',
      ...parseCoordinates(cell(raw, sheet.columns, 'latitude'), cell(raw, sheet.columns, 'longitude'), errors),
      ...parseGeofence(cell(raw, sheet.columns, 'geofence'), errors),
    };

    const text: Array<[ImportColumn, string]> = [
      ['region', 'regionName'], ['address', 'address'], ['city', 'city'],
      ['area', 'area'], ['scope_variant', 'scopeVariant'], ['status', 'status'],
    ];
    for (const [column, field] of text) {
      const value = cell(raw, sheet.columns, column);
      if (value !== undefined) candidate[field] = value;
    }
    // A blank status is the schema's default, not a clear — there is no
    // "no status" state on a site.
    if (candidate['status'] === null) delete candidate['status'];

    if (siteCode.length > 0) {
      const first = seen.get(siteCode);
      if (first !== undefined) errors.push(`site code ${siteCode} appears more than once in this file (first on row ${first})`);
      else seen.set(siteCode, raw.rowNumber);
    }

    const parsed = SiteImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${issue.path.join('.') || 'row'}: ${issue.message}`);
    }
    return { rowNumber: raw.rowNumber, row: errors.length === 0 && parsed.success ? parsed.data : null, errors };
  });
}

/** Header text to a known column: lowercased, trimmed, spaces and hyphens folded to underscores. */
export function normalizeHeader(raw: string): ImportColumn | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (IMPORT_COLUMNS as readonly string[]).includes(key) ? (key as ImportColumn) : null;
}
```

`apps/project/src/project/import/workbook.ts`:

```ts
import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { IMPORT_ROW_LIMIT, type ImportColumn } from '@ipms/contracts';
import { normalizeHeader, type RawRow, type SheetContents } from './parse.js';

/**
 * Reads the first worksheet into plain strings.
 *
 * Everything becomes a string here and is parsed in `parse.ts`, so validation
 * never has to care whether Excel stored a coordinate as a number, a formula
 * result, or text a client typed with a stray space.
 */
export async function readSheet(buffer: Buffer): Promise<SheetContents> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new BadRequestException('That file could not be read as an Excel workbook');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('That workbook has no worksheets');

  const columns: ImportColumn[] = [];
  const unknownHeaders: string[] = [];
  const positions = new Map<number, ImportColumn>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const text = String(cell.text ?? '');
    if (text.trim().length === 0) return;
    const column = normalizeHeader(text);
    if (!column) { unknownHeaders.push(text.trim()); return; }
    positions.set(colNumber, column);
    columns.push(column);
  });

  if (!columns.includes('site_code') || !columns.includes('name')) {
    throw new BadRequestException('The sheet needs at least a site_code column and a name column');
  }

  const rows: RawRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: Partial<Record<ImportColumn, string>> = {};
    let hasValue = false;
    for (const [colNumber, column] of positions) {
      const text = String(row.getCell(colNumber).text ?? '');
      if (text.trim().length > 0) hasValue = true;
      cells[column] = text;
    }
    // A trailing run of formatting-only rows is normal in a hand-edited
    // spreadsheet and must not count against the cap or report as invalid.
    if (!hasValue) continue;
    rows.push({ rowNumber, cells });
    if (rows.length > IMPORT_ROW_LIMIT) {
      throw new BadRequestException(`This file has more than ${IMPORT_ROW_LIMIT} rows. Split it and import each part.`);
    }
  }

  if (rows.length === 0) throw new BadRequestException('That sheet has a header row and no data');
  return { columns, unknownHeaders, rows };
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm --filter project test
```

Expected: PASS — 13 new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/project/src/project/import apps/project/package.json pnpm-lock.yaml
git commit -m "feat(project): parse and validate a site import workbook

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Preview and commit in the service

Classification is shared by both: preview reports it, commit re-derives it.

**Files:**
- Create: `apps/project/src/project/import/site-import.service.ts`
- Test: `apps/project/src/project/import/site-import.service.spec.ts`

**Interfaces:**
- Consumes: `parseRows`, `readSheet` from Task 8; `SiteImportCommitDto`, `SiteImportPreviewDto`, `SiteImportRowReport` from Task 7.
- Produces: `SiteImportService` with `preview(projectId: string, file: Buffer): Promise<SiteImportPreviewDto>` and `commit(projectId: string, dto: SiteImportCommitDto): Promise<{ created: number; updated: number }>`; and the exported pure helper `diffSite(existing, row, columns): SiteImportFieldChange[]`.

- [ ] **Step 1: Write the failing tests**

`apps/project/src/project/import/site-import.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffSite } from './site-import.service.js';
import type { ImportColumn } from '@ipms/contracts';

const existing = {
  siteCode: 'S1', name: 'One', city: 'Kathmandu', address: null, area: null,
  scopeVariant: null, status: 'PLANNED', latitude: null, longitude: null,
  geofenceMode: 'INHERIT', geofenceRadiusM: null, region: { name: 'North' },
};

describe('diffSite', () => {
  it('reports a changed field', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', city: 'Pokhara' } as never, ['site_code', 'name', 'city'] as ImportColumn[]);
    expect(changes).toEqual([{ field: 'city', from: 'Kathmandu', to: 'Pokhara' }]);
  });

  it('reports nothing when the value is unchanged', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', city: 'Kathmandu' } as never, ['site_code', 'name', 'city'] as ImportColumn[]);
    expect(changes).toEqual([]);
  });

  // The rule that protects a three-column correction file from wiping data.
  it('ignores a field whose column is absent from the sheet', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One' } as never, ['site_code', 'name'] as ImportColumn[]);
    expect(changes).toEqual([]);
  });

  // The other half: a blank cell in a present column IS a clear, and the
  // manager must see it before confirming.
  it('reports a blank cell in a present column as a clear', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', city: null } as never, ['site_code', 'name', 'city'] as ImportColumn[]);
    expect(changes).toEqual([{ field: 'city', from: 'Kathmandu', to: null }]);
  });

  it('reports a region change by name', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', regionName: 'South' } as never, ['site_code', 'name', 'region'] as ImportColumn[]);
    expect(changes).toEqual([{ field: 'region', from: 'North', to: 'South' }]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter project test
```

Expected: FAIL — cannot resolve `./site-import.service.js`.

- [ ] **Step 3: Implement**

`apps/project/src/project/import/site-import.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import {
  uuidv7, type ImportColumn, type SiteImportCommitDto, type SiteImportFieldChange,
  type SiteImportPreviewDto, type SiteImportRowDto, type SiteImportRowReport,
} from '@ipms/contracts';
import { parseRows } from './parse.js';
import { readSheet } from './workbook.js';

/** Which sheet column carries each site field, for the missing-column rule. */
const FIELD_COLUMNS: Array<[keyof SiteImportRowDto, ImportColumn, string]> = [
  ['name', 'name', 'name'],
  ['regionName', 'region', 'region'],
  ['latitude', 'latitude', 'latitude'],
  ['longitude', 'longitude', 'longitude'],
  ['address', 'address', 'address'],
  ['city', 'city', 'city'],
  ['area', 'area', 'area'],
  ['scopeVariant', 'scope_variant', 'scopeVariant'],
  ['status', 'status', 'status'],
];

const show = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

interface ExistingSite {
  siteCode: string; name: string; city: string | null; address: string | null;
  area: string | null; scopeVariant: string | null; status: string;
  latitude: unknown; longitude: unknown;
  geofenceMode: string; geofenceRadiusM: number | null;
  region: { name: string } | null;
}

/**
 * What a commit would overwrite on an existing site.
 *
 * Only columns the sheet declared are considered: a manager who exports just
 * site_code, latitude and longitude to fix coordinates must not be shown — or
 * dealt — a clear of every address in the project.
 */
export function diffSite(existing: ExistingSite, row: SiteImportRowDto, columns: ImportColumn[]): SiteImportFieldChange[] {
  const changes: SiteImportFieldChange[] = [];
  for (const [field, column, label] of FIELD_COLUMNS) {
    if (!columns.includes(column)) continue;
    const next = row[field];
    if (next === undefined) continue;
    const before = label === 'region' ? (existing.region?.name ?? null) : show(existing[label as keyof ExistingSite]);
    const after = show(next);
    if (before !== after) changes.push({ field: label, from: before, to: after });
  }
  if (columns.includes('geofence') && row.geofenceMode !== undefined) {
    const before = existing.geofenceMode === 'CUSTOM' ? String(existing.geofenceRadiusM) : existing.geofenceMode;
    const after = row.geofenceMode === 'CUSTOM' ? String(row.geofenceRadiusM) : row.geofenceMode;
    if (before !== after) changes.push({ field: 'geofence', from: before, to: after });
  }
  return changes;
}

@Injectable()
export class SiteImportService {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(projectId: string, file: Buffer): Promise<SiteImportPreviewDto> {
    await this.requireProject(projectId);
    const sheet = await readSheet(file);
    const parsed = parseRows(sheet);

    const codes = parsed.flatMap((entry) => (entry.row ? [entry.row.siteCode] : []));
    const existing = new Map(
      (await this.prisma.site.findMany({ where: { projectId, siteCode: { in: codes } }, include: { region: true } }))
        .map((site) => [site.siteCode, site as unknown as ExistingSite]),
    );

    const rows: SiteImportRowReport[] = parsed.map((entry) => {
      if (!entry.row) return { rowNumber: entry.rowNumber, action: 'INVALID', siteCode: null, errors: entry.errors, changes: [] };
      const match = existing.get(entry.row.siteCode);
      return {
        rowNumber: entry.rowNumber,
        action: match ? 'UPDATE' : 'CREATE',
        siteCode: entry.row.siteCode,
        errors: [],
        changes: match ? diffSite(match, entry.row, sheet.columns) : [],
      };
    });

    const summary = {
      created: rows.filter((row) => row.action === 'CREATE').length,
      updated: rows.filter((row) => row.action === 'UPDATE').length,
      invalid: rows.filter((row) => row.action === 'INVALID').length,
    };

    return {
      columns: sheet.columns,
      summary,
      rows,
      // All-or-nothing: one bad row and there is nothing to confirm.
      importable: summary.invalid > 0 ? null : { columns: sheet.columns, rows: parsed.flatMap((e) => (e.row ? [e.row] : [])) },
    };
  }

  /**
   * Applies the whole file or none of it.
   *
   * Re-validates against the database rather than trusting the preview: rows
   * arrive as JSON from the client, and the project may have changed since.
   */
  async commit(projectId: string, dto: SiteImportCommitDto): Promise<{ created: number; updated: number }> {
    await this.requireProject(projectId);

    const duplicates = dto.rows.map((row) => row.siteCode).filter((code, index, all) => all.indexOf(code) !== index);
    if (duplicates.length > 0) throw new BadRequestException(`Duplicate site codes in this import: ${[...new Set(duplicates)].join(', ')}`);

    const existing = new Map(
      (await this.prisma.site.findMany({ where: { projectId, siteCode: { in: dto.rows.map((row) => row.siteCode) } } }))
        .map((site) => [site.siteCode, site.id]),
    );

    return this.prisma.$transaction(async (tx) => {
      const names = [...new Set(dto.rows.flatMap((row) => (row.regionName ? [row.regionName] : [])))];
      const regions = new Map<string, string>();
      for (const name of names) {
        const region = await tx.region.upsert({
          where: { projectId_name: { projectId, name } },
          update: {},
          create: { id: uuidv7(), projectId, name },
        });
        regions.set(name, region.id);
      }

      const regionFor = (row: SiteImportRowDto): string | null =>
        row.regionName ? (regions.get(row.regionName) ?? null) : null;

      const fields = (row: SiteImportRowDto): Record<string, unknown> => ({
        ...(row.name === undefined ? {} : { name: row.name }),
        ...(row.latitude === undefined ? {} : { latitude: row.latitude }),
        ...(row.longitude === undefined ? {} : { longitude: row.longitude }),
        ...(row.address === undefined ? {} : { address: row.address }),
        ...(row.city === undefined ? {} : { city: row.city }),
        ...(row.area === undefined ? {} : { area: row.area }),
        ...(row.scopeVariant === undefined ? {} : { scopeVariant: row.scopeVariant }),
        ...(row.status === undefined ? {} : { status: row.status }),
        ...(row.geofenceMode === undefined ? {} : { geofenceMode: row.geofenceMode, geofenceRadiusM: row.geofenceRadiusM ?? null }),
        ...(dto.columns.includes('region') ? { regionId: regionFor(row) } : {}),
      });

      const creates = dto.rows.filter((row) => !existing.has(row.siteCode));
      const updates = dto.rows.filter((row) => existing.has(row.siteCode));

      if (creates.length > 0) {
        await tx.site.createMany({
          data: creates.map((row) => ({
            id: uuidv7(), projectId, siteCode: row.siteCode, name: row.name,
            regionId: regionFor(row),
            latitude: row.latitude ?? null, longitude: row.longitude ?? null,
            geofenceMode: row.geofenceMode ?? 'INHERIT', geofenceRadiusM: row.geofenceRadiusM ?? null,
            address: row.address ?? null, city: row.city ?? null, area: row.area ?? null,
            scopeVariant: row.scopeVariant ?? null, status: row.status ?? 'PLANNED',
          })),
        });
      }

      // Prisma has no bulk update for differing values, which is why the row
      // cap in the contracts keeps this loop bounded.
      for (const row of updates) {
        const id = existing.get(row.siteCode);
        if (id) await tx.site.update({ where: { id }, data: fields(row) });
      }

      return { created: creates.length, updated: updates.length };
    });
  }

  private async requireProject(id: string): Promise<void> {
    if (!(await this.prisma.project.findUnique({ where: { id } }))) throw new NotFoundException('Project not found');
  }
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter project test
```

Expected: PASS — 5 new `diffSite` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/project/src/project/import
git commit -m "feat(project): site import preview and all-or-nothing commit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Template download, and the three routes

**Files:**
- Create: `apps/project/src/project/import/template.ts`
- Modify: `apps/project/src/project/project.controller.ts`, `apps/project/src/app.module.ts`, `apps/project/src/main.ts`, `apps/project/package.json`
- Test: `apps/project/src/project/import/template.spec.ts`

**Interfaces:**
- Consumes: `SiteImportService` from Task 9.
- Produces: `buildTemplate(defaultRadius: number | null): Promise<Buffer>`; routes `GET /projects/:id/sites/import/template`, `POST /projects/:id/sites/import/preview`, `POST /projects/:id/sites/import/commit`.

- [ ] **Step 1: Add the multipart plugin**

```bash
pnpm --filter project add @fastify/multipart@10.1.1
```

- [ ] **Step 2: Write the failing test**

`apps/project/src/project/import/template.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS } from '@ipms/contracts';
import { buildTemplate } from './template.js';

describe('buildTemplate', () => {
  it('produces a workbook whose header row is exactly the import columns', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate(500));
    const headers = workbook.worksheets[0]?.getRow(1).values as string[];
    expect(headers.slice(1)).toEqual([...IMPORT_COLUMNS]);
  });

  it('round-trips through the parser it is a template for', async () => {
    const { readSheet } = await import('./workbook.js');
    const { parseRows } = await import('./parse.js');
    const sheet = await readSheet(await buildTemplate(500));
    expect(parseRows(sheet).every((row) => row.errors.length === 0)).toBe(true);
  });
});
```

The second test is the point of having a template at all: the example row it ships must survive the importer unchanged.

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm --filter project test
```

Expected: FAIL — cannot resolve `./template.js`.

- [ ] **Step 4: Implement**

`apps/project/src/project/import/template.ts`:

```ts
import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS } from '@ipms/contracts';

/** One valid example row, which the template's own test parses to prove it is importable. */
const EXAMPLE: Record<string, string> = {
  site_code: 'SITE_001', name: 'Example Site', region: 'Bagmati',
  latitude: '27.7172', longitude: '85.3240', geofence: '',
  address: '1 Example Road', city: 'Kathmandu', area: 'Thamel',
  scope_variant: 'Standard', status: 'PLANNED',
};

export async function buildTemplate(defaultRadius: number | null): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sites');
  sheet.addRow([...IMPORT_COLUMNS]);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(IMPORT_COLUMNS.map((column) => EXAMPLE[column] ?? ''));
  for (const [index, column] of IMPORT_COLUMNS.entries()) sheet.getColumn(index + 1).width = Math.max(column.length + 4, 14);

  const notes = workbook.addWorksheet('Notes');
  notes.addRow(['site_code and name are required. Every other column is optional.']);
  notes.addRow(['Delete a column you do not want to change — a column left out is never written.']);
  notes.addRow(['A blank cell in a column that IS present clears that field.']);
  notes.addRow(['latitude and longitude must be filled in together, or both left blank.']);
  notes.addRow([
    defaultRadius === null
      ? 'geofence: blank uses this project setting, which is currently NO proximity check. Enter "off", or a radius in metres.'
      : `geofence: blank uses this project default of ${defaultRadius} m. Enter "off" for no check, or a radius in metres.`,
  ]);
  notes.getColumn(1).width = 110;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

Register the plugin in `apps/project/src/main.ts`, after `NestFactory.create` and before `app.listen`:

```ts
await app.register(import('@fastify/multipart'), { limits: { fileSize: IMPORT_FILE_BYTES, files: 1 } });
```

with `IMPORT_FILE_BYTES` added to the `@ipms/contracts` import. The limit is enforced by the plugin, so an oversized upload is refused before it is buffered.

Add to `apps/project/src/app.module.ts`: import `SiteImportService`, and add it to `providers`:

```ts
{provide:SiteImportService,useFactory:(prisma:PrismaService)=>new SiteImportService(prisma.db),inject:[PrismaService]},
```

Add to `ProjectController` — the constructor gains `private readonly imports: SiteImportService`:

```ts
  @Get('projects/:id/sites/import/template') @RequirePermission('site.import') async template(@Param('id') id:string,@Res() reply:FastifyReply){ const project=await this.service.getProject(UuidSchema.parse(id)); const file=await buildTemplate(project.defaultGeofenceRadiusM); return reply.header('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition',`attachment; filename="sites-${project.code}.xlsx"`).send(file); }
  @Post('projects/:id/sites/import/preview') @RequirePermission('site.import') async previewImport(@Param('id') id:string,@Req() req:FastifyRequest){ const file=await req.file(); if(!file) throw new BadRequestException('Attach an .xlsx file in a "file" field'); return this.imports.preview(UuidSchema.parse(id),await file.toBuffer()); }
  @Post('projects/:id/sites/import/commit') @RequirePermission('site.import') commitImport(@Param('id') id:string,@Body() body:unknown){ return this.imports.commit(UuidSchema.parse(id),SiteImportCommitSchema.parse(body)); }
```

adding `Res`, `BadRequestException` to the `@nestjs/common` imports, `type FastifyReply, type FastifyRequest` from `fastify`, `SiteImportCommitSchema` to the contracts import, and `buildTemplate` / `SiteImportService` from the import folder.

No gateway change is needed: `/api/v1/projects` is already an allowlisted prefix, and the proxy streams bodies with `reply.from`, which carries multipart through unbuffered.

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm --filter project test && pnpm --filter project typecheck
```

Expected: PASS.

- [ ] **Step 6: Verify the endpoints against a running service**

```bash
pnpm --filter project exec node dist/main.js &
curl -s -o /tmp/sites.xlsx -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3004/api/v1/projects/$PROJECT_ID/sites/import/template"
curl -s -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/sites.xlsx" "http://127.0.0.1:3004/api/v1/projects/$PROJECT_ID/sites/import/preview"
```

Expected: `200` for the template, then a preview JSON reading `"created": 1, "updated": 0, "invalid": 0` for the example row.

- [ ] **Step 7: Commit**

```bash
git add apps/project pnpm-lock.yaml
git commit -m "feat(project): site import template, preview and commit endpoints

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: QC records the submission's distance

Restores the QC test target, which was removed while the service had no tests.

**Files:**
- Modify: `apps/qc/prisma/schema.prisma`; create `apps/qc/prisma/migrations/20260921000200_submission_geofence/migration.sql`
- Modify: `libs/contracts/src/qc/qc.ts:21` (`CreateSubmissionSchema`)
- Create: `apps/qc/src/qc/site-geofence.client.ts`, `apps/qc/vitest.config.ts`
- Modify: `apps/qc/src/qc/qc.service.ts`, `apps/qc/src/qc/qc.controller.ts`, `apps/qc/src/app.module.ts`, `apps/qc/package.json`
- Test: `apps/qc/src/qc/qc.service.spec.ts`

**Interfaces:**
- Consumes: `haversineMeters` from Task 1; `GET /internal/sites/:id/geofence` from Task 6.
- Produces: `SiteGeofenceClient.fetch(siteId: string, bearer: string): Promise<SiteGeofence | null>` (`null` = unreachable); `resolveGeofence(site, submitted)` returning `{ geofenceStatus: GeofenceStatus; distanceFromSiteM: number | null }`; `GeofenceStatus = 'INSIDE' | 'OUTSIDE' | 'NO_FIX' | 'NOT_APPLICABLE' | 'UNVERIFIED'`.

- [ ] **Step 1: Migration and schema**

`apps/qc/prisma/migrations/20260921000200_submission_geofence/migration.sql`:

```sql
ALTER TABLE "submission" ADD COLUMN "latitude" decimal(10,7);
ALTER TABLE "submission" ADD COLUMN "longitude" decimal(10,7);
ALTER TABLE "submission" ADD COLUMN "distanceFromSiteM" integer;
ALTER TABLE "submission" ADD COLUMN "geofenceStatus" varchar(20) NOT NULL DEFAULT 'NOT_APPLICABLE';
```

In `apps/qc/prisma/schema.prisma`, in `model Submission`, after the `deviceId` line:

```prisma
  latitude Decimal? @db.Decimal(10,7)
  longitude Decimal? @db.Decimal(10,7)
  distanceFromSiteM Int?
  geofenceStatus String @default("NOT_APPLICABLE") @db.VarChar(20)
```

- [ ] **Step 2: Restore the test target and add dependencies**

```bash
pnpm --filter qc add @ipms/geo@workspace:*
```

`apps/qc/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

In `apps/qc/package.json`, delete the `_comment` line and add:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Write the failing tests**

`apps/qc/src/qc/qc.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveGeofence } from './site-geofence.client.js';

const SITE = { latitude: 27.7172, longitude: 85.324, effectiveRadiusM: 500 };

describe('resolveGeofence', () => {
  it('is INSIDE within the radius', () => {
    expect(resolveGeofence(SITE, { latitude: 27.7175, longitude: 85.324 })).toMatchObject({ geofenceStatus: 'INSIDE' });
  });

  it('is OUTSIDE beyond it, and says by how far', () => {
    const result = resolveGeofence(SITE, { latitude: 27.7372, longitude: 85.324 });
    expect(result.geofenceStatus).toBe('OUTSIDE');
    expect(result.distanceFromSiteM).toBeGreaterThan(500);
  });

  // The project service could not be reached. Distinct from "we checked and
  // it was fine" and from "there was nothing to check".
  it('is UNVERIFIED when the site could not be fetched', () => {
    expect(resolveGeofence(null, { latitude: 27.7, longitude: 85.3 })).toEqual({ geofenceStatus: 'UNVERIFIED', distanceFromSiteM: null });
  });

  it('is NOT_APPLICABLE when the site runs no check', () => {
    expect(resolveGeofence({ ...SITE, effectiveRadiusM: null }, { latitude: 27.7, longitude: 85.3 })).toMatchObject({ geofenceStatus: 'NOT_APPLICABLE' });
  });

  it('is NOT_APPLICABLE when the site has no coordinates', () => {
    expect(resolveGeofence({ latitude: null, longitude: null, effectiveRadiusM: 500 }, { latitude: 27.7, longitude: 85.3 })).toMatchObject({ geofenceStatus: 'NOT_APPLICABLE' });
  });

  it('is NO_FIX when the device sent no coordinates', () => {
    expect(resolveGeofence(SITE, {})).toEqual({ geofenceStatus: 'NO_FIX', distanceFromSiteM: null });
  });

  // Precedence: a site with no check answers NOT_APPLICABLE even when the
  // device also had no fix. "We were not checking" is the more useful answer.
  it('prefers NOT_APPLICABLE over NO_FIX', () => {
    expect(resolveGeofence({ ...SITE, effectiveRadiusM: null }, {})).toMatchObject({ geofenceStatus: 'NOT_APPLICABLE' });
  });
});
```

And the never-throws guarantee, tested where it actually lives. `resolveGeofence` above proves a `null` site becomes `UNVERIFIED`; these prove that every way the lookup can fail produces that `null` instead of an exception:

```ts
import { afterEach, vi } from 'vitest';
import { SiteGeofenceClient } from './site-geofence.client.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('SiteGeofenceClient.fetch — never throws', () => {
  const client = new SiteGeofenceClient('http://project:3004');

  it('returns null when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(client.fetch('s-1', 'Bearer t')).resolves.toBeNull();
  });

  it('returns null on a non-2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    await expect(client.fetch('s-1', 'Bearer t')).resolves.toBeNull();
  });

  it('returns null when the answer is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
    await expect(client.fetch('s-1', 'Bearer t')).resolves.toBeNull();
  });

  it('forwards the caller’s bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ latitude: null, longitude: null, effectiveRadiusM: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await client.fetch('s-1', 'Bearer t');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://project:3004/api/v1/internal/sites/s-1/geofence');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });
});
```

- [ ] **Step 4: Run and watch it fail**

```bash
pnpm --filter qc test
```

Expected: FAIL — cannot resolve `./site-geofence.client.js`.

- [ ] **Step 5: Implement**

`apps/qc/src/qc/site-geofence.client.ts`:

```ts
import { haversineMeters } from '@ipms/geo';

export type GeofenceStatus = 'INSIDE' | 'OUTSIDE' | 'NO_FIX' | 'NOT_APPLICABLE' | 'UNVERIFIED';

export interface SiteGeofence {
  latitude: number | null;
  longitude: number | null;
  effectiveRadiusM: number | null;
}

export interface GeofenceOutcome {
  geofenceStatus: GeofenceStatus;
  distanceFromSiteM: number | null;
}

/**
 * Classifies one submission against its site.
 *
 * Ordered by precedence and evaluated first-match. Pure: the fetch that can
 * fail happens in `SiteGeofenceClient`, and its failure arrives here as a
 * `null` site, so every branch is reachable from a unit test.
 */
export function resolveGeofence(
  site: SiteGeofence | null,
  submitted: { latitude?: number; longitude?: number },
): GeofenceOutcome {
  if (!site) return { geofenceStatus: 'UNVERIFIED', distanceFromSiteM: null };
  if (site.latitude === null || site.longitude === null || site.effectiveRadiusM === null) {
    return { geofenceStatus: 'NOT_APPLICABLE', distanceFromSiteM: null };
  }
  if (submitted.latitude === undefined || submitted.longitude === undefined) {
    return { geofenceStatus: 'NO_FIX', distanceFromSiteM: null };
  }
  const distance = haversineMeters(
    { latitude: site.latitude, longitude: site.longitude },
    { latitude: submitted.latitude, longitude: submitted.longitude },
  );
  return { geofenceStatus: distance <= site.effectiveRadiusM ? 'INSIDE' : 'OUTSIDE', distanceFromSiteM: distance };
}

/**
 * Reads a site's geofence from the project service.
 *
 * Returns `null` on any failure rather than throwing. A submission is field
 * work already done; losing it because this lookup timed out would be a far
 * worse outcome than not knowing where it was filed from.
 *
 * Forwards the submitting user's own bearer token, so the endpoint stays
 * permission-checked and this needs no shared secret or service identity.
 */
export class SiteGeofenceClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 2000) {}

  async fetch(siteId: string, bearer: string): Promise<SiteGeofence | null> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}/api/v1/internal/sites/${siteId}/geofence`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return null;
      return (await response.json()) as SiteGeofence;
    } catch {
      return null;
    }
  }
}
```

In `libs/contracts/src/qc/qc.ts`, add to the `CreateSubmissionSchema` object, before `responses`:

```ts
latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(),
```

Independently optional on purpose: a device with no fix sends neither, and rejecting an unpaired coordinate here would block a submission.

In `apps/qc/src/qc/qc.service.ts`, the constructor becomes
`constructor(private readonly prisma: PrismaClient, private readonly geofence: SiteGeofenceClient) {}`,
and in `createSubmission`, after the `integrityHash` line:

```ts
    const outcome = resolveGeofence(await this.geofence.fetch(dto.siteId, bearer), dto);
```

with `bearer: string` added as the third parameter of `createSubmission`, and these fields added to the `tx.submission.create` data literal:

```ts
latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, distanceFromSiteM: outcome.distanceFromSiteM, geofenceStatus: outcome.geofenceStatus,
```

In `QcController`, the submit handler forwards the raw header:

```ts
@Post('qc/submissions')@RequirePermission('qc_submission.create') submit(@Body()body:unknown,@Req()req:{user:AuthzUser;headers:Record<string,string|undefined>}){return this.service.createSubmission(CreateSubmissionSchema.parse(body),req.user.id,req.headers['authorization']??'');}
```

In `apps/qc/src/app.module.ts`, provide the client and inject it:

```ts
{provide:SiteGeofenceClient,useFactory:()=>new SiteGeofenceClient(process.env['PROJECT_INTERNAL_URL']??'http://project:3004')},
{provide:QcService,useFactory:(prisma:PrismaService,geofence:SiteGeofenceClient)=>new QcService(prisma.db,geofence),inject:[PrismaService,SiteGeofenceClient]},
```

Add to `.env.example`:

```
PROJECT_INTERNAL_URL=http://127.0.0.1:3004
```

- [ ] **Step 6: Run and watch it pass**

```bash
pnpm --filter qc exec prisma migrate deploy && pnpm --filter qc prisma:generate && pnpm --filter qc test && pnpm --filter @ipms/contracts test
```

Expected: PASS — 11 new QC tests, and the QC test target runs for the first time.

- [ ] **Step 7: Commit**

```bash
git add apps/qc libs/contracts/src/qc .env.example pnpm-lock.yaml
git commit -m "feat(qc): record submission distance from site

Never throws: an unreachable project service records UNVERIFIED rather
than failing a submission that represents work already done.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Web — multipart support and the import client

**Files:**
- Modify: `apps/web/app/lib/api-client.ts`, `apps/web/app/lib/project-api.ts`
- Test: `apps/web/app/lib/api-client.spec.ts`, `apps/web/app/lib/project-api.spec.ts`

**Interfaces:**
- Consumes: the endpoints from Task 10.
- Produces: `authFetch` accepting `body?: BodyInit`; `previewSiteImport(projectId, file: File): Promise<ApiResult<SiteImportPreviewDto>>`; `commitSiteImport(projectId, payload: SiteImportCommitDto): Promise<ApiResult<{ created: number; updated: number }>>`; the `Site` interface updated with `geofenceMode` and a nullable `geofenceRadiusM`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/lib/api-client.spec.ts`:

Append inside the existing `describe('authFetch — the request it builds')`, which already runs `signedIn()` in its `beforeEach`:

```ts
  it('sends a raw body without forcing a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.set('file', new Blob(['x']), 'sites.xlsx');
    await authFetch('/api/v1/x', { method: 'POST', body: form });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(form);
    // Set explicitly, the multipart boundary would be missing and the upload
    // would be unparseable upstream — fetch must derive it from the FormData.
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('still sends JSON bodies with a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/v1/x', { method: 'POST', json: { a: 1 } });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter web test
```

Expected: FAIL — `body` is not a property of `ApiRequest`.

- [ ] **Step 3: Implement**

In `apps/web/app/lib/api-client.ts`, add to `ApiRequest`:

```ts
  /**
   * Sent as the request body verbatim, for uploads. The content type is left
   * unset on purpose: `fetch` derives it from a `FormData` body along with the
   * multipart boundary, and setting it by hand omits the boundary and makes
   * the upload unparseable upstream.
   */
  body?: BodyInit;
```

and in the `fetch` call, replace the body and content-type spreads with:

```ts
      headers: {
        authorization: `Bearer ${token}`,
        ...(request.json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(request.json !== undefined ? { body: JSON.stringify(request.json) } : request.body !== undefined ? { body: request.body } : {}),
```

In `apps/web/app/lib/project-api.ts`, update the `Site` interface:

```ts
  geofenceMode: 'INHERIT' | 'CUSTOM' | 'OFF';
  geofenceRadiusM: number | null;
```

add `defaultGeofenceRadiusM: number | null;` to `Project`, and append:

```ts
export async function previewSiteImport(projectId: string, file: File): Promise<ApiResult<SiteImportPreviewDto>> {
  const body = new FormData();
  body.set('file', file, file.name);
  return authFetch<SiteImportPreviewDto>(`/api/v1/projects/${projectId}/sites/import/preview`, { method: 'POST', body });
}

export async function commitSiteImport(projectId: string, payload: SiteImportCommitDto): Promise<ApiResult<{ created: number; updated: number }>> {
  return authFetch(`/api/v1/projects/${projectId}/sites/import/commit`, { method: 'POST', json: payload });
}
```

importing `type SiteImportCommitDto, type SiteImportPreviewDto` from `@ipms/contracts`.

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter web test
```

Expected: PASS, with the existing 80 web tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib
git commit -m "feat(web): multipart uploads and the site import client

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Web — coordinates and geofence on the forms

The fields have existed in the database, the contracts and the service since the foundation and have never been reachable from a browser.

**Files:**
- Modify: `apps/web/app/projects/forms.tsx` (`CreateSiteForm` **and** `CreateProjectForm`), `apps/web/app/projects/actions.ts` (`createSiteAction`, `updateSiteAction`, `createProjectAction`), `apps/web/app/projects/[id]/page.tsx`
- Test: `apps/web/app/projects/actions.spec.ts`

**Interfaces:**
- Consumes: `createSite`, `updateSite` with the Task 4 DTOs.
- Produces: no new exports — the existing Server Actions now carry the geofence fields.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/projects/actions.spec.ts`, following the module-mock pattern that file already uses:

```ts
it('sends coordinates and a custom geofence', async () => {
  const form = new FormData();
  form.set('projectId', PROJECT_ID);
  form.set('siteCode', 'SITE_01');
  form.set('name', 'One');
  form.set('latitude', '27.7172');
  form.set('longitude', '85.3240');
  form.set('geofenceMode', 'CUSTOM');
  form.set('geofenceRadiusM', '250');
  await createSiteAction({}, form);
  expect(createSite).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({
    latitude: 27.7172, longitude: 85.324, geofenceMode: 'CUSTOM', geofenceRadiusM: 250,
  }));
});

it('rejects a latitude with no longitude before calling the API', async () => {
  const form = new FormData();
  form.set('projectId', PROJECT_ID);
  form.set('siteCode', 'SITE_01');
  form.set('name', 'One');
  form.set('latitude', '27.7172');
  const state = await createSiteAction({}, form);
  expect(state.error).toContain('together');
  expect(createSite).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter web test
```

Expected: FAIL — the call carries no coordinates.

- [ ] **Step 3: Implement**

Add to `apps/web/app/projects/actions.ts`, above `createSiteAction`:

```ts
/**
 * The geofence half of a site form, as the API wants it.
 *
 * Returns an error string rather than throwing, so the caller can answer the
 * form directly. The lone-coordinate check is repeated here rather than left
 * to the service: a round trip to be told the obvious is a worse answer than
 * an immediate one.
 */
function siteGeofenceFields(form: FormData): { fields: Record<string, unknown> } | { error: string } {
  const latitude = optional(form, 'latitude');
  const longitude = optional(form, 'longitude');
  if ((latitude === undefined) !== (longitude === undefined)) {
    return { error: 'Latitude and longitude must be given together, or both left blank.' };
  }
  const mode = optional(form, 'geofenceMode') ?? 'INHERIT';
  const radius = optional(form, 'geofenceRadiusM');
  if (mode === 'CUSTOM' && radius === undefined) return { error: 'A custom geofence needs a radius in metres.' };
  return {
    fields: {
      ...(latitude === undefined ? {} : { latitude: Number(latitude) }),
      ...(longitude === undefined ? {} : { longitude: Number(longitude) }),
      geofenceMode: mode,
      ...(mode === 'CUSTOM' && radius !== undefined ? { geofenceRadiusM: Number(radius) } : {}),
    },
  };
}
```

In `createSiteAction`, after the existing required-field check:

```ts
  const geofence = siteGeofenceFields(form);
  if ('error' in geofence) return { error: geofence.error };
```

and spread `...geofence.fields` into the `createSite` call. Do the same in `updateSiteAction` for `updateSite`.

In `createProjectAction`, after the other optional reads:

```ts
  const defaultGeofenceRadiusM = optional(form, 'defaultGeofenceRadiusM');
```

and in the `createProject` call:

```ts
    ...(defaultGeofenceRadiusM === undefined ? {} : { defaultGeofenceRadiusM: defaultGeofenceRadiusM === 'off' ? null : Number(defaultGeofenceRadiusM) }),
```

Extend `CreateSiteForm` in `apps/web/app/projects/forms.tsx`, after the City field:

```tsx
      <label className="field">Latitude<input name="latitude" type="number" step="any" min={-90} max={90} /></label>
      <label className="field">Longitude<input name="longitude" type="number" step="any" min={-180} max={180} /></label>
      <label className="field">Geofence
        <select name="geofenceMode" defaultValue="INHERIT">
          <option value="INHERIT">Use the project default</option>
          <option value="CUSTOM">Custom radius</option>
          <option value="OFF">No proximity check</option>
        </select>
      </label>
      <label className="field">Radius (m)<input name="geofenceRadiusM" type="number" min={1} max={100000} /></label>
```

Extend `CreateProjectForm` in the same file, after its existing date fields — this is spec §7.2, and it is what lets a fiber project switch proximity off once for every site it will ever import:

```tsx
      <label className="field">Default geofence
        <select name="defaultGeofenceRadiusM" defaultValue="500">
          <option value="500">500 m</option>
          <option value="250">250 m</option>
          <option value="1000">1 km</option>
          <option value="off">No proximity checks on this project</option>
        </select>
      </label>
```

`"off"` is mapped to `null` by `createProjectAction` above. A project created through this form therefore always states its rule explicitly rather than relying on the column default.

In `apps/web/app/projects/[id]/page.tsx`, add a geofence cell to the sites table, after the city cell — so a manager can see at a glance which sites are checked:

```tsx
                        <td>{site.geofenceMode === 'CUSTOM' ? `${site.geofenceRadiusM} m` : site.geofenceMode === 'OFF' ? 'No check' : 'Project default'}</td>
```

adding a matching `<th>Geofence</th>` to that table's header row.

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter web test && pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/projects
git commit -m "feat(web): coordinates and geofence controls on the site form

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Web — the import screen

**Files:**
- Create: `apps/web/app/projects/[id]/sites/import/page.tsx`, `apps/web/app/projects/[id]/sites/import/import-form.tsx`, `apps/web/app/projects/[id]/sites/import/actions.ts`
- Modify: `apps/web/app/projects/[id]/page.tsx` (link to it)
- Test: `apps/web/app/projects/[id]/sites/import/actions.spec.ts`

**Interfaces:**
- Consumes: `previewSiteImport`, `commitSiteImport` from Task 12.
- Produces: `previewImportAction(previous, form): Promise<ImportState>` and `commitImportAction(previous, form): Promise<ImportState>`, where `ImportState = FormState & { preview?: SiteImportPreviewDto; committed?: { created: number; updated: number } }`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/projects/[id]/sites/import/actions.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/project-api', () => ({
  previewSiteImport: vi.fn(),
  commitSiteImport: vi.fn(),
}));

const { previewSiteImport, commitSiteImport } = await import('../../../../lib/project-api');
const { previewImportAction, commitImportAction } = await import('./actions');

const PROJECT_ID = '0192f7a0-0000-7000-8000-000000000001';

beforeEach(() => { vi.clearAllMocks(); });

describe('previewImportAction', () => {
  it('rejects a submission with no file', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    expect((await previewImportAction({}, form)).error).toContain('Choose a file');
    expect(previewSiteImport).not.toHaveBeenCalled();
  });

  it('returns the preview on success', async () => {
    const preview = { columns: ['site_code'], summary: { created: 1, updated: 0, invalid: 0 }, rows: [], importable: { columns: ['site_code'], rows: [] } };
    vi.mocked(previewSiteImport).mockResolvedValue({ state: 'ready', data: preview } as never);
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('file', new File(['x'], 'sites.xlsx'));
    expect((await previewImportAction({}, form)).preview).toEqual(preview);
  });
});

describe('commitImportAction', () => {
  // All-or-nothing: with an invalid row there is nothing to confirm, and the
  // button that would send this is not rendered.
  it('refuses to commit when the preview had no importable payload', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('payload', 'null');
    expect((await commitImportAction({}, form)).error).toContain('Fix the file');
    expect(commitSiteImport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter web test
```

Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 3: Implement the actions**

`apps/web/app/projects/[id]/sites/import/actions.ts`:

```ts
'use server';
import type { SiteImportCommitDto, SiteImportPreviewDto } from '@ipms/contracts';
import { commitSiteImport, previewSiteImport } from '../../../../lib/project-api';
import { type FormState } from '../../../form-state';
import { settle } from '../../../settle';

export interface ImportState extends FormState {
  preview?: SiteImportPreviewDto;
  committed?: { created: number; updated: number };
}

export async function previewImportAction(_previous: ImportState, form: FormData): Promise<ImportState> {
  const projectId = String(form.get('projectId'));
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a .xlsx file to preview.' };

  const result = await previewSiteImport(projectId, file);
  // Nothing was written, so there is nothing to revalidate — but settle still
  // handles an expired session and the service's own error messages.
  const state = await settle(result, `/projects/${projectId}/sites/import`);
  if (state.error) return state;
  return result.state === 'ready' ? { preview: result.data } : state;
}

export async function commitImportAction(_previous: ImportState, form: FormData): Promise<ImportState> {
  const projectId = String(form.get('projectId'));
  const raw = String(form.get('payload'));
  let payload: SiteImportCommitDto | null = null;
  try {
    payload = JSON.parse(raw) as SiteImportCommitDto | null;
  } catch {
    payload = null;
  }
  if (!payload) return { error: 'Fix the file and preview it again before importing.' };

  const result = await commitSiteImport(projectId, payload);
  const state = await settle(result, `/projects/${projectId}`);
  if (state.error) return state;
  return result.state === 'ready' ? { committed: result.data } : state;
}
```

- [ ] **Step 4: Implement the screen**

`apps/web/app/projects/[id]/sites/import/import-form.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { SubmitButton } from '../../../forms';
import { commitImportAction, previewImportAction, type ImportState } from './actions';

const EMPTY: ImportState = {};

export function SiteImportForm({ projectId }: { projectId: string }) {
  const [preview, runPreview] = useActionState(previewImportAction, EMPTY);
  const [commit, runCommit] = useActionState(commitImportAction, EMPTY);

  if (commit.committed) {
    return (
      <p className="form-note">
        Imported {commit.committed.created} new site(s) and updated {commit.committed.updated}.
        {' '}<a href={`/projects/${projectId}`}>Back to the project</a>
      </p>
    );
  }

  return (
    <>
      <form action={runPreview} className="inline-form">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="field">Spreadsheet<input name="file" type="file" accept=".xlsx" required /></label>
        <SubmitButton>Preview</SubmitButton>
        {preview.error ? <p className="form-error">{preview.error}</p> : null}
      </form>

      {preview.preview ? (
        <>
          <p className="form-note">
            {preview.preview.summary.created} new · {preview.preview.summary.updated} to update
            {' · '}{preview.preview.summary.invalid} invalid
          </p>
          <table>
            <thead><tr><th>Row</th><th>Site code</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {preview.preview.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td><code>{row.siteCode ?? '—'}</code></td>
                  <td><span className="badge">{row.action}</span></td>
                  <td>
                    {row.action === 'INVALID'
                      ? row.errors.join('; ')
                      : row.changes.length === 0
                        ? '—'
                        : row.changes.map((change) => `${change.field}: ${change.from ?? '(none)'} → ${change.to ?? '(none)'}`).join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview.preview.importable ? (
            <form action={runCommit}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="payload" value={JSON.stringify(preview.preview.importable)} />
              <SubmitButton>Import {preview.preview.summary.created + preview.preview.summary.updated} site(s)</SubmitButton>
              {commit.error ? <p className="form-error">{commit.error}</p> : null}
            </form>
          ) : (
            <p className="form-note">Fix the rows above and preview again. Nothing is imported until every row is valid.</p>
          )}
        </>
      ) : null}
    </>
  );
}
```

`apps/web/app/projects/[id]/sites/import/page.tsx`:

```tsx
import { SiteImportForm } from './import-form';

export default async function SiteImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page">
      <h1>Import sites</h1>
      <p className="form-note">
        <a href={`/api/v1/projects/${id}/sites/import/template`}>Download the template</a>
        {' — '}site_code and name are required. A column you leave out is never written; a blank cell in a
        column you include clears that field.
      </p>
      <SiteImportForm projectId={id} />
    </main>
  );
}
```

In `apps/web/app/projects/[id]/page.tsx`, inside the sites panel header, beside the existing create form:

```tsx
            {may('site.import') ? <a className="button" href={`/projects/${data.id}/sites/import`}>Import from Excel</a> : null}
```

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build
```

Expected: PASS, and a clean Next build.

- [ ] **Step 6: Verify the whole loop by hand**

Start the stack, sign in as `manager`, open a project, and:

1. Download the template. Confirm the Notes sheet names the project's current default radius.
2. Upload it unchanged. Expect `1 new · 0 to update · 0 invalid`, and import it.
3. Edit the example row's `name`, re-upload, and confirm the preview reads `0 new · 1 to update` with a `name` diff.
4. Delete every column but `site_code` and `name`, re-upload, and confirm the diff does **not** claim to clear `city` or `latitude`.
5. Put `99` in `latitude`, re-upload, and confirm the row is `INVALID` and the import button is absent.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/projects
git commit -m "feat(web): bulk site import screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Integration tests against real Postgres

Spec §8 asks for these, and they cover what a hand-written Prisma double structurally cannot: that the commit transaction really rolls back, that the region upsert really deduplicates, and that the Task 3 migration really preserved existing radii. Placed here rather than beside Task 9 because it needs the endpoints and the migration both in place.

**Files:**
- Create: `apps/project/prisma/site-import.integration.spec.ts`
- Modify: `apps/project/vitest.config.ts` (add the Testcontainers setup file and widen `include`), `apps/project/package.json` (add `@testcontainers/postgresql`)

**Interfaces:**
- Consumes: `SiteImportService` from Task 9; the migration from Task 3.
- Produces: nothing — tests only.

- [ ] **Step 1: Wire up Testcontainers**

```bash
pnpm --filter project add -D @testcontainers/postgresql
```

`apps/project/vitest.config.ts` — the current `include` is `['src/**/*.spec.ts']`, which would skip a spec under `prisma/`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    // Resolves DOCKER_HOST for Testcontainers so integration tests run on a
    // fresh clone and in CI without anyone exporting env vars by hand.
    setupFiles: ['../../tools/vitest-setup-containers.ts'],
  },
});
```

- [ ] **Step 2: Write the tests**

`apps/project/prisma/site-import.integration.spec.ts`, following `apps/iam/prisma/seed.integration.spec.ts` for container setup:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/project';
import { uuidv7 } from '@ipms/contracts';
import { SiteImportService } from '../src/project/import/site-import.service.js';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let imports: SiteImportService;
let projectId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  imports = new SiteImportService(prisma);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.site.deleteMany({});
  await prisma.region.deleteMany({});
  await prisma.project.deleteMany({});
  projectId = uuidv7();
  await prisma.project.create({ data: { id: projectId, code: 'ALPHA', name: 'Alpha', defaultGeofenceRadiusM: 500 } });
});

const row = (over: Record<string, unknown>) => ({ rowNumber: 2, siteCode: 'S1', name: 'One', ...over });

/**
 * Calls the service directly, past the contract schema.
 *
 * Deliberate: these tests exercise what Postgres enforces, so one of them
 * sends a name longer than the schema would ever allow through the endpoint.
 */
const commit = (payload: { columns: string[]; rows: Array<Record<string, unknown>> }) =>
  imports.commit(projectId, payload as never);

describe('commit', () => {
  it('creates every row in one go', async () => {
    const result = await commit({
      columns: ['site_code', 'name'],
      rows: [row({ siteCode: 'S1', rowNumber: 2 }), row({ siteCode: 'S2', name: 'Two', rowNumber: 3 })],
    });
    expect(result).toEqual({ created: 2, updated: 0 });
    expect(await prisma.site.count({ where: { projectId } })).toBe(2);
  });

  it('updates an existing site rather than failing on its code', async () => {
    await commit({ columns: ['site_code', 'name'], rows: [row({})] });
    const result = await commit({ columns: ['site_code', 'name'], rows: [row({ name: 'Renamed' })] });
    expect(result).toEqual({ created: 0, updated: 1 });
    expect((await prisma.site.findFirst({ where: { projectId } }))?.name).toBe('Renamed');
  });

  // One region row for four hundred sites in the same region.
  it('deduplicates region upserts', async () => {
    await commit({
      columns: ['site_code', 'name', 'region'],
      rows: [
        row({ siteCode: 'S1', regionName: 'North', rowNumber: 2 }),
        row({ siteCode: 'S2', regionName: 'North', rowNumber: 3 }),
        row({ siteCode: 'S3', regionName: 'South', rowNumber: 4 }),
      ],
    });
    expect(await prisma.region.count({ where: { projectId } })).toBe(2);
  });

  // The all-or-nothing guarantee. A row that violates the unique index mid
  // transaction must leave the project exactly as it was.
  it('rolls the whole file back when one row fails at the database', async () => {
    await prisma.site.create({ data: { id: uuidv7(), projectId, siteCode: 'S2', name: 'Existing' } });
    // The second row's name is past varchar(200). Only Postgres rejects that
    // — the service is called directly here, so nothing catches it earlier —
    // which is exactly the mid-transaction failure the rollback must survive.
    // S1 must not survive it, and the pre-existing S2 must.
    await expect(commit({
      columns: ['site_code', 'name'],
      rows: [row({ siteCode: 'S1', rowNumber: 2 }), row({ siteCode: 'S3', name: 'x'.repeat(300), rowNumber: 3 })],
    })).rejects.toThrow();
    expect(await prisma.site.findFirst({ where: { projectId, siteCode: 'S1' } })).toBeNull();
    expect(await prisma.site.count({ where: { projectId } })).toBe(1);
  });

  it('refuses duplicate site codes within one commit', async () => {
    await expect(commit({
      columns: ['site_code', 'name'],
      rows: [row({ rowNumber: 2 }), row({ rowNumber: 3 })],
    })).rejects.toThrow('Duplicate site codes');
  });

  it('leaves a field alone when its column is absent, and clears it when present and blank', async () => {
    await commit({ columns: ['site_code', 'name', 'city'], rows: [row({ city: 'Kathmandu' })] });

    await commit({ columns: ['site_code', 'name'], rows: [row({})] });
    expect((await prisma.site.findFirst({ where: { projectId } }))?.city).toBe('Kathmandu');

    await commit({ columns: ['site_code', 'name', 'city'], rows: [row({ city: null })] });
    expect((await prisma.site.findFirst({ where: { projectId } }))?.city).toBeNull();
  });
});

describe('the geofence migration', () => {
  // Task 3's whole point: an existing site must not silently adopt the new
  // 500 m project default.
  it('leaves a migrated site on its own radius, and a new site inheriting', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "site" ("id","projectId","siteCode","name","geofenceMode","geofenceRadiusM") VALUES ($1,$2,'OLD','Old','CUSTOM',100)`,
      uuidv7(), projectId,
    );
    await commit({ columns: ['site_code', 'name'], rows: [row({ siteCode: 'NEW', name: 'New' })] });

    const old = await prisma.site.findFirst({ where: { projectId, siteCode: 'OLD' } });
    const fresh = await prisma.site.findFirst({ where: { projectId, siteCode: 'NEW' } });
    expect(old).toMatchObject({ geofenceMode: 'CUSTOM', geofenceRadiusM: 100 });
    expect(fresh).toMatchObject({ geofenceMode: 'INHERIT', geofenceRadiusM: null });
  });
});
```

- [ ] **Step 3: Run them**

```bash
pnpm --filter project test
```

Expected: PASS. First run pulls `postgres:17-alpine`, so allow a few minutes. If Docker is not running, these fail at `beforeAll` with a Testcontainers connection error — start Docker rather than skipping them.

- [ ] **Step 4: Commit**

```bash
git add apps/project pnpm-lock.yaml
git commit -m "test(project): real-Postgres coverage for import commit and migration

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Full verification

**Files:** none — this task only runs what exists.

- [ ] **Step 1: Run everything**

```bash
pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

Expected: every target green, including the QC test target that this plan restored.

- [ ] **Step 2: Confirm the migration is honest about existing data**

```bash
psql "$PROJECT_DATABASE_URL" -c "SELECT \"geofenceMode\", count(*) FROM site GROUP BY 1;"
```

Expected: sites that existed before Task 3 read `CUSTOM`; anything imported since reads `INHERIT` unless its sheet said otherwise.

- [ ] **Step 3: Confirm the internal endpoint is unreachable from outside**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/api/v1/internal/sites/$SITE_ID/geofence"
```

Expected: `404` from the gateway. A `200` here means the `/internal/` guard regressed and the task is not done.

- [ ] **Step 4: Commit any fixes and open the PR**

```bash
git push -u origin feat/site-bulk-import-geofence
```

---

## Notes for the implementer

**Where the spec and this plan deliberately differ.** The spec's Prisma snippets show `@map("geofence_radius_m")`. The init migration created that column as quoted camelCase `"geofenceRadiusM"`, so adding the map would rename a live column. Every new column here is quoted camelCase with no `@map`, matching its neighbours.

**What is intentionally not built.** There is no QC reviewer screen, so `distanceFromSiteM` and `geofenceStatus` are stored and returned by the API but displayed nowhere (spec §7.4). There is no at-capture proximity warning, because it must work offline and belongs in the Flutter client (spec §6.3). Neither is an oversight; do not add them to close the loop.

**The one rule most likely to be got wrong.** A column missing from the sheet and a blank cell in a present column mean different things. Task 8 encodes it in `cell()`'s three-state return and Task 9 in `diffSite`'s `columns.includes(column)` guard. If a refactor collapses `undefined` and `null` there, a manager's three-column coordinate-correction file will silently wipe every other field on every site it touches.
