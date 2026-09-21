# Pending Services Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `media`, `notification` and `docs` as bootable, migrated, gateway-routed NestJS services carrying their §7.4 domain schema, with no business endpoints.

**Architecture:** Each service follows the pattern established by `audit`, `project` and `qc` exactly — Fastify + Nest, a `/api/v1` global prefix with health and metrics excluded, two `APP_GUARD`s (`JwtUserGuard` then `AuthzGuard`), a Prisma client generated into the app's own `node_modules/@prisma-clients/<svc>`, and its own Postgres role and database that no other service can reach. Nothing in this plan adds an endpoint, a contract schema, or an external integration.

**Tech Stack:** NestJS 12 · Fastify · Prisma 7.10 (driver adapter over `pg`) · PostgreSQL 17 · Vitest 4 · pnpm 10.15 workspaces · Nx 23 · Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-20-pending-services-scaffold-design.md`

## Global Constraints

- Node `>=22.13.0`, pnpm `10.15.0`. Do not change either.
- Dependency versions must match the existing services **exactly** — copy from `apps/qc/package.json`. No version bumps in this plan.
- Every Prisma schema must set `output = "../node_modules/@prisma-clients/<svc>"`. Omitting it makes pnpm's content-addressable store collapse two services' generated clients into one folder, and the second `prisma generate` silently overwrites the first.
- Ports: `media` 3006, `notification` 3007, `docs` 3008. Port 3002 stays unallocated.
- Coordinates are `Decimal @db.Decimal(10,7)`. Instants are `@db.Timestamptz(6)`. Enum-like strings are bounded `@db.VarChar`.
- `APP_GUARD` registration order is `JwtUserGuard` then `AuthzGuard`. Reversing it means `AuthzGuard` reads a `request.user` that does not exist yet.
- No new `@ipms/contracts` entries, no new permission codes, no `STREAMS` entries, no S3/FCM/SMTP configuration. These are the four deliberate deferrals in §6 of the spec; each gets a comment, not an implementation.
- `docker/Dockerfile.service` and `.github/workflows/ci.yml` must not be modified. Both are already generic over the service name.

---

## File Structure

**Created — three times, once per service** (`<svc>` ∈ `media`, `notification`, `docs`):

| File | Responsibility |
|---|---|
| `apps/<svc>/package.json` | Workspace package, build/test/typecheck scripts, pinned deps |
| `apps/<svc>/tsconfig.json` | Extends base, `paths: {}` so libs resolve as built packages |
| `apps/<svc>/tsconfig.build.json` | Emit-only, excludes specs |
| `apps/<svc>/vitest.config.ts` | Node environment, `src/**/*.spec.ts` |
| `apps/<svc>/prisma.config.ts` | Schema and migrations paths, `DATABASE_URL` |
| `apps/<svc>/prisma/schema.prisma` | §7.4 models, client output location |
| `apps/<svc>/prisma/migrations/migration_lock.toml` | `provider = "postgresql"` |
| `apps/<svc>/prisma/migrations/<ts>_init_<svc>/migration.sql` | Initial DDL |
| `apps/<svc>/src/main.ts` | Fastify bootstrap, prefix, shutdown hooks |
| `apps/<svc>/src/app.module.ts` | Guards, scope/override providers, Prisma + readiness |
| `apps/<svc>/src/prisma.service.ts` | `PrismaBaseService` over `<SVC>_DATABASE_URL` |
| `apps/<svc>/src/app.module.spec.ts` | Guard registration is wired, not merely declared |

**Modified:**

| File | Change |
|---|---|
| `apps/gateway/src/proxy/routes.ts` | Three host/port constants, three `ROUTES` entries |
| `apps/gateway/src/proxy/routes.spec.ts` | **One existing test breaks** — see Task 1, Step 1 |
| `docker/postgres/init.sql` | Three roles, three databases, revokes and grants |
| `docker/docker-compose.yml` | Six entries — a `<svc>-migrate` and a `<svc>` each |
| `.env.example` | Three `<SVC>_DATABASE_URL` lines |
| `libs/authz/src/permissions.ts` | The §6.4 deferral comment only — no new codes |

**Not modified, deliberately:** `docker/Dockerfile.service`, `.github/workflows/ci.yml`, `pnpm-workspace.yaml` (already globs `apps/*`), `vitest.workspace.ts` (already globs `apps/*/vitest.config.ts`), `eslint.config.mjs` (already globs `apps/**/*.ts`), `nx.json`, and **`libs/events`** — see the note below.

---

## Three things that will bite you

**1. An existing gateway test asserts `/api/v1/media` is unroutable.**
`apps/gateway/src/proxy/routes.spec.ts:42` reads:

```ts
it('refuses a path on no declared prefix', () => {
  expect(resolveUpstream('/api/v1/media')).toBeUndefined();
});
```

Task 1 Step 1 changes it. If you add the route first, you will see a passing-then-failing suite and wonder why.

**2. `init.sql` only runs on a fresh Postgres volume.**
`docker/postgres/init.sql` is mounted into `/docker-entrypoint-initdb.d/`, which Postgres executes **only when initialising an empty data directory**. If you already have a `ipms_postgres-data` volume, editing `init.sql` changes nothing and the migrate containers will fail with `role "ipms_media" does not exist`. Task 1 Step 13 handles both cases.

**3. Do not add `media.photo.*` to `SUBJECTS`.**
It is tempting — the subjects are named in §8 of the architecture spec, and two string
constants look free. They are not. `libs/events/src/subjects.spec.ts` asserts:

```ts
it('covers every subject with exactly one stream', () => { … })
```

Every entry in `SUBJECTS` must be covered by exactly one entry in `STREAMS`. Adding the
constants without a `MEDIA` stream fails that test, and adding the stream would create
durable consumers that nothing reads. Both halves land together with the first media
event producer or consumer. **`libs/events` is not touched by this plan.**

**Migration SQL is generated, not hand-written.** The repo contains both styles — `iam` and `audit` are Prisma-generated, `project` and `qc` are hand-compacted. Use generated: it cannot drift from the schema. The command needs no database:

```bash
DATABASE_URL="postgresql://dummy" pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

(`--to-schema-datamodel` was removed in Prisma 7. The dummy `DATABASE_URL` is only to satisfy `prisma.config.ts` at load time; `--from-empty` never connects.)

---

## Task 1: `media` service

The largest of the three — it owns the outbox table and the two deferral comments. Tasks 2 and 3 repeat this shape with smaller schemas.

**Files:**
- Modify: `apps/gateway/src/proxy/routes.spec.ts:40-43`
- Modify: `apps/gateway/src/proxy/routes.ts:26-52`
- Create: `apps/media/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `prisma.config.ts`
- Create: `apps/media/prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20260921000100_init_media/migration.sql`
- Create: `apps/media/src/main.ts`, `app.module.ts`, `prisma.service.ts`, `app.module.spec.ts`
- Modify: `docker/postgres/init.sql`, `docker/docker-compose.yml`, `.env.example`

**Interfaces:**
- Consumes: `PrismaBaseService` from `@ipms/persistence`; `HealthController`, `MetricsController`, `registerReadinessCheck` from `@ipms/observability`; `JwtUserGuard`, `AuthzGuard`, `SCOPE_PROVIDER`, `OVERRIDE_PROVIDER`, `emptyOverrideProvider`, types `AuthzScope` and `ScopeProvider` from `@ipms/authz`.
- Produces: `apps/media` as workspace package `media` on port 3006, reachable at gateway prefix `/api/v1/media`. Tasks 2 and 3 copy this file layout verbatim.

- [ ] **Step 1: Fix the breaking test and add the failing route tests**

In `apps/gateway/src/proxy/routes.spec.ts`, replace the existing `refuses a path on no declared prefix` test:

```ts
  it('refuses a path on no declared prefix', () => {
    expect(resolveUpstream('/api/v1/billing')).toBeUndefined();
  });
```

Then add a new test immediately after the `routes the qc prefix to the qc service` test:

```ts
  it('routes the media prefix to the media service', () => {
    const upstream = resolveUpstream('/api/v1/media/objects');
    expect(upstream?.service).toBe('media');
    expect(upstream?.port).toBe(3006);
  });

  it('keeps media internal paths private', () => {
    expect(resolveUpstream('/api/v1/media/internal/objects')).toBeUndefined();
  });

  it('keeps the media prefix authenticated', () => {
    expect(isPublicPath('/api/v1/media')).toBe(false);
    expect(isPublicPath('/api/v1/media/objects')).toBe(false);
  });
```

- [ ] **Step 2: Run the gateway tests to verify they fail**

```bash
pnpm --filter gateway test
```

Expected: FAIL — `routes the media prefix to the media service` gets `undefined` for `upstream?.service`. The two other new tests pass already (an undeclared prefix is neither routable nor public), which is correct: they are regression guards, not drivers.

- [ ] **Step 3: Add the media route**

In `apps/gateway/src/proxy/routes.ts`, after the `QC` constant (line ~30):

```ts
const MEDIA = { host: upstreamHost('media', 'media'), port: upstreamPort('media', 3006) };
```

And in the `ROUTES` array, after the `/api/v1/qc` entry:

```ts
  { prefix: '/api/v1/media', service: 'media', ...MEDIA },
```

- [ ] **Step 4: Run the gateway tests to verify they pass**

```bash
pnpm --filter gateway test
```

Expected: PASS, all tests.

- [ ] **Step 5: Commit the gateway route**

```bash
git add apps/gateway/src/proxy/routes.ts apps/gateway/src/proxy/routes.spec.ts
git commit -m "feat(gateway): route the media prefix

The existing 'no declared prefix' test used /api/v1/media as its example
of an unroutable path. It now names a prefix that stays undeclared.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Create the package and TypeScript configuration**

`apps/media/package.json`:

```json
{
  "name": "media",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@ipms/authz": "workspace:*",
    "@ipms/contracts": "workspace:*",
    "@ipms/observability": "workspace:*",
    "@ipms/persistence": "workspace:*",
    "@nestjs/common": "12.0.3",
    "@nestjs/config": "12.0.0",
    "@nestjs/core": "12.0.3",
    "@nestjs/platform-fastify": "12.0.3",
    "@prisma/adapter-pg": "7.10.0",
    "@prisma/client": "7.10.0",
    "@prisma/client-runtime-utils": "7.10.0",
    "pg": "8.23.0"
  },
  "devDependencies": {
    "@types/pg": "8.23.1",
    "prisma": "7.10.0"
  }
}
```

`apps/media/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "types": ["node"],
    // The `@ipms/*` libraries are consumed as built packages through
    // node_modules, the same way this service would consume them if it moved
    // to its own repository. The workspace path aliases would instead compile
    // each library's source into this service's output.
    "paths": {}
  },
  "include": ["src/**/*.ts", "prisma/**/*.ts"]
}
```

`apps/media/tsconfig.build.json`:

```json
{
  // Emit-only variant; see the note in any library's tsconfig.build.json for
  // why the tests are excluded here rather than in tsconfig.json.
  "extends": "./tsconfig.json",
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

`apps/media/vitest.config.ts`:

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

`apps/media/prisma.config.ts`:

```ts
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

- [ ] **Step 7: Install so the workspace links the new package**

```bash
pnpm install
```

Expected: pnpm reports `+ media` among the workspace projects. Without this the `@ipms/*` workspace dependencies are unresolvable and every later step fails on imports.

- [ ] **Step 8: Write the Prisma schema**

`apps/media/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  // Each service must generate into its own location: with no `output`, Prisma 7
  // writes generated client code into the *installed* @prisma/client package,
  // and pnpm's content-addressable store collapses two services' identical
  // @prisma/client@7.10.0 dependency into one physical folder — the second
  // service to run `prisma generate` silently overwrites the first.
  output = "../node_modules/@prisma-clients/media"
}
datasource db {
  provider = "postgresql"
}

model MediaObject {
  id String @id @db.Uuid
  storageKey String @unique @db.VarChar(500)
  contentType String @db.VarChar(100)
  sizeBytes Int
  contentHash String @db.VarChar(64)
  thumbnailKey String? @db.VarChar(500)
  status String @default("PENDING") @db.VarChar(20)
  uploadedBy String @db.Uuid
  capturedAt DateTime? @db.Timestamptz(6)
  latitude Decimal? @db.Decimal(10,7)
  longitude Decimal? @db.Decimal(10,7)
  watermarkVerified Boolean @default(false)
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // How a duplicate upload is recognised. Added with the table because adding
  // it later means a migration on a table holding every photo in the system.
  @@index([contentHash])
  @@map("media_object")
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

- [ ] **Step 9: Generate the Prisma client**

```bash
DATABASE_URL="postgresql://dummy" pnpm --filter media exec prisma generate
```

Expected: `Generated Prisma Client ... to ./apps/media/node_modules/@prisma-clients/media`. If it writes anywhere else, the `output` line is wrong — stop and fix it.

- [ ] **Step 10: Generate the initial migration**

```bash
mkdir -p apps/media/prisma/migrations/20260921000100_init_media
printf '# Please do not edit this file manually\nprovider = "postgresql"\n' > apps/media/prisma/migrations/migration_lock.toml
cd apps/media && DATABASE_URL="postgresql://dummy" pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/20260921000100_init_media/migration.sql && cd ../..
```

Expected: `apps/media/prisma/migrations/20260921000100_init_media/migration.sql` contains `CREATE TABLE "media_object"`, `CREATE TABLE "outbox_event"`, and two `CREATE INDEX` statements. Open it and confirm — a `migrate diff` failure writes an empty file rather than erroring loudly.

- [ ] **Step 11: Write the service source**

`apps/media/src/prisma.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/media';
import { PrismaBaseService } from '@ipms/persistence';

@Injectable()
export class PrismaService extends PrismaBaseService {
  protected readonly client: PrismaClient;

  constructor() {
    super();
    const connectionString = process.env['MEDIA_DATABASE_URL'];
    if (!connectionString) throw new Error('MEDIA_DATABASE_URL is not set');
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  get db(): PrismaClient {
    return this.client;
  }
}
```

`apps/media/src/app.module.ts`:

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

/**
 * `media` has no resource-bearing endpoints yet, so `check()` never consults a
 * scope. An empty, non-global scope is therefore the *least* permissive value
 * available to it, not a stub. Do NOT "fix" this into `global: true` — that
 * would silently grant scope-based access to every project and site the moment
 * a future change starts passing a resource into `check()`.
 */
const mediaScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController],
  providers: [
    // Registration order matters: APP_GUARD providers run in the order they are
    // listed. JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: mediaScopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());

        /**
         * DEFERRED — object storage (spec 2026-09-20 §6.1).
         *
         * Evidence photos belong in Cloudflare R2 (parent spec §12,
         * assumption 2). No S3 client, no `S3_*` configuration and no storage
         * readiness check exist yet, deliberately: configuration that nothing
         * reads is configuration that lies, and an operator who set `S3_BUCKET`
         * against this scaffold would reasonably conclude uploads were wired.
         *
         * Add all three in the same change as the first presigned-upload
         * endpoint. The readiness check is not optional once the client exists —
         * a `media` that reports ready while its bucket is unreachable will
         * accept presign requests it cannot honour.
         *
         * DEFERRED — media events and their stream (spec 2026-09-20 §6.3).
         *
         * `media.photo.processed` and `media.photo.rejected` (architecture spec
         * §8) are in neither `SUBJECTS` nor `STREAMS`, and the outbox table
         * below has no drainer. Both halves must land together:
         * `libs/events/src/subjects.spec.ts` asserts every subject is covered by
         * exactly one stream, which is the mechanical form of "a subject with no
         * stream is a message that vanishes". Adding the constants alone fails
         * that test; adding the stream alone creates durable consumers nothing
         * reads.
         *
         * Whichever comes first — the first producer here, or the first consumer
         * in `notification` — adds the subjects, the `MEDIA` stream and its
         * consumers in one change, widening the `STREAMS` key union as it goes.
         */
        return prisma;
      },
    },
  ],
})
export class AppModule {}
```

`apps/media/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('media');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.enableShutdownHooks();

  /**
   * Business routes live under the same `/api/v1` prefix the gateway forwards,
   * so a path is spelled identically whether it arrives through the edge or
   * directly against the container. Health and metrics are excluded: the
   * orchestrator and the scrape job address them by fixed path, and prefixing
   * them would break the container healthcheck.
   */
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  const port = Number(process.env['PORT'] ?? 3006);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'media service listening');
}

bootstrap().catch((err: unknown) => {
  log.fatal({ err }, 'media service failed to start');
  process.exit(1);
});
```

- [ ] **Step 12: Write the guard registration test**

`apps/media/src/app.module.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER } from '@ipms/authz';
import { AppModule } from './app.module.js';

interface ClassProvider {
  provide: unknown;
  useClass?: unknown;
}

function isClassProvider(value: unknown): value is ClassProvider {
  return typeof value === 'object' && value !== null && 'provide' in value;
}

/**
 * `reflect-metadata` is a transitive dependency (pulled in by `@nestjs/common`,
 * which side-effect-imports it) rather than one `media` declares directly, so it
 * cannot be `import`ed here under pnpm's isolated node_modules — but the polyfill
 * is already installed on the global `Reflect` object by the time this file runs.
 * This narrow cast is only to give `Reflect.getMetadata` a type.
 */
const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };

/**
 * Proves the guards are wired, not just declared. `audit` once shipped
 * `@RequirePermission(...)` decorators with no guard registered anywhere, so
 * they were inert metadata and its API was unprotected at the service level.
 * Reading the module's own `@Module()` metadata rather than boot-testing keeps
 * this from needing Postgres, NATS or Redis.
 */
describe('AppModule guard registration', () => {
  const providers = reflectMetadata.getMetadata('providers', AppModule) as unknown[];

  it('registers exactly two APP_GUARD providers', () => {
    const guards = providers.filter(isClassProvider).filter((p) => p.provide === APP_GUARD);
    expect(guards).toHaveLength(2);
  });

  it('registers JwtUserGuard before AuthzGuard, so request.user exists before AuthzGuard reads it', () => {
    const guards = providers.filter(isClassProvider).filter((p) => p.provide === APP_GUARD);
    expect(guards[0]?.useClass).toBe(JwtUserGuard);
    expect(guards[1]?.useClass).toBe(AuthzGuard);
  });

  it('provides SCOPE_PROVIDER for AuthzGuard to inject', () => {
    expect(providers.filter(isClassProvider).some((p) => p.provide === SCOPE_PROVIDER)).toBe(true);
  });

  it('provides OVERRIDE_PROVIDER, without which the module fails at bootstrap', () => {
    expect(providers.filter(isClassProvider).some((p) => p.provide === OVERRIDE_PROVIDER)).toBe(true);
  });
});
```

- [ ] **Step 13: Run the media tests, typecheck, lint and build**

```bash
pnpm --filter media test && pnpm nx run-many -t typecheck lint build -p media
```

Expected: 4 tests pass; typecheck, lint and build all succeed.

- [ ] **Step 14: Add the database role and database**

Append to `docker/postgres/init.sql`, extending each existing group:

```sql
CREATE ROLE ipms_media WITH LOGIN PASSWORD 'ipms_media';

CREATE DATABASE ipms_media OWNER ipms_media;

REVOKE ALL ON DATABASE ipms_media FROM PUBLIC;

GRANT CONNECT ON DATABASE ipms_media TO ipms_media;
```

**If you already have a Postgres volume**, `init.sql` will not re-run — it executes only when the data directory is empty. Apply the same statements to the running container:

```bash
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ipms_media WITH LOGIN PASSWORD 'ipms_media';
CREATE DATABASE ipms_media OWNER ipms_media;
REVOKE ALL ON DATABASE ipms_media FROM PUBLIC;
GRANT CONNECT ON DATABASE ipms_media TO ipms_media;
SQL
```

Expected: `CREATE ROLE`, `CREATE DATABASE`, `REVOKE`, `GRANT`. A `role already exists` error is harmless — it means a previous run got this far.

- [ ] **Step 15: Add the Compose entries**

In `docker/docker-compose.yml`, after the `qc` service and before `gateway`:

```yaml
  media-migrate:
    <<: *migrate-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      target: migrate
      args: { SERVICE: media }
    environment:
      DATABASE_URL: postgresql://ipms_media:ipms_media@postgres:5432/ipms_media

  media:
    <<: *service-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      args: { SERVICE: media }
    depends_on:
      <<: *infra-ready
      media-migrate: { condition: service_completed_successfully }
    environment:
      <<: *service-env
      PORT: 3006
      MEDIA_DATABASE_URL: postgresql://ipms_media:ipms_media@postgres:5432/ipms_media
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3006/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

Do **not** add `media` to the `gateway` service's `depends_on`. The gateway proxies at request time and has no endpoints to wait for; adding it only slows the edge's startup.

In `.env.example`, after the `QC_DATABASE_URL` line:

```
MEDIA_DATABASE_URL=postgresql://ipms_media:ipms_media@localhost:5432/ipms_media
```

- [ ] **Step 16: Bring the service up and verify it is healthy and routed**

```bash
docker compose -f docker/docker-compose.yml up -d --build media gateway
docker compose -f docker/docker-compose.yml ps media
```

Expected: `media` shows `healthy`. If `media-migrate` exited non-zero, read its log — `role "ipms_media" does not exist` means Step 14's volume case was skipped.

```bash
docker compose -f docker/docker-compose.yml logs media-migrate --tail 20
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/media/objects
```

Expected: `401`. That is the correct answer and proves the whole path — the gateway resolved the prefix and refused an unauthenticated request. A `404` means the route did not resolve; recheck Step 3.

- [ ] **Step 17: Run the full verification and commit**

```bash
pnpm exec vitest run && pnpm nx run-many -t typecheck lint build
```

Expected: all pass. In particular `libs/events` must be untouched and green — if
`subjects.spec.ts` fails here, something added a subject without its stream.

```bash
git add apps/media docker/postgres/init.sql docker/docker-compose.yml .env.example
git commit -m "feat(media): scaffold the media service

Bootable, migrated and routed, carrying the MediaObject model from the
architecture spec §7.4 plus the outbox it will publish through. No
endpoints yet.

Object storage and the media event subjects are deliberately absent, and
the module comment names the change that should add each. The subjects
wait on their stream because subjects.spec.ts requires every subject to
map to exactly one — a subject without a stream is a message that
vanishes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `notification` service

Same shape as Task 1 with a two-model schema, no outbox, and the FCM/SMTP deferral note.

**Files:**
- Modify: `apps/gateway/src/proxy/routes.ts`, `apps/gateway/src/proxy/routes.spec.ts`
- Create: `apps/notification/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `prisma.config.ts`
- Create: `apps/notification/prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20260921000200_init_notification/migration.sql`
- Create: `apps/notification/src/main.ts`, `app.module.ts`, `prisma.service.ts`, `app.module.spec.ts`
- Modify: `docker/postgres/init.sql`, `docker/docker-compose.yml`, `.env.example`

**Interfaces:**
- Consumes: the same `@ipms/*` exports as Task 1.
- Produces: workspace package `notification` on port 3007, gateway prefix `/api/v1/notifications`.

- [ ] **Step 1: Write the failing route tests**

In `apps/gateway/src/proxy/routes.spec.ts`, after the media tests:

```ts
  it('routes the notifications prefix to the notification service', () => {
    const upstream = resolveUpstream('/api/v1/notifications');
    expect(upstream?.service).toBe('notification');
    expect(upstream?.port).toBe(3007);
  });

  it('keeps the notifications prefix authenticated', () => {
    expect(isPublicPath('/api/v1/notifications')).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter gateway test
```

Expected: FAIL — `routes the notifications prefix...` gets `undefined`.

- [ ] **Step 3: Add the route**

In `apps/gateway/src/proxy/routes.ts`, after the `MEDIA` constant:

```ts
const NOTIFICATION = { host: upstreamHost('notification', 'notification'), port: upstreamPort('notification', 3007) };
```

And in `ROUTES`, after the media entry:

```ts
  { prefix: '/api/v1/notifications', service: 'notification', ...NOTIFICATION },
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter gateway test
```

Expected: PASS.

- [ ] **Step 5: Create the package and TypeScript configuration**

Every one of these files is byte-identical to the `apps/media` version from Task 1 Step 6 except for the package name, so derive them rather than retyping:

```bash
mkdir -p apps/notification/src apps/notification/prisma
sed 's/"name": "media"/"name": "notification"/' apps/media/package.json > apps/notification/package.json
cp apps/media/tsconfig.json apps/media/tsconfig.build.json apps/media/vitest.config.ts apps/media/prisma.config.ts apps/notification/
```

Verify the name took:

```bash
head -3 apps/notification/package.json
```

Expected: `"name": "notification"`. If it still reads `media`, the `sed` did not match and every later `--filter notification` command will fail.

- [ ] **Step 6: Install**

```bash
pnpm install
```

Expected: pnpm reports `+ notification`.

- [ ] **Step 7: Write the Prisma schema**

`apps/notification/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  // Each service must generate into its own location — see the note in
  // apps/iam/prisma/schema.prisma for what happens when two services share one.
  output = "../node_modules/@prisma-clients/notification"
}
datasource db {
  provider = "postgresql"
}

model Notification {
  id String @id @db.Uuid
  recipientId String @db.Uuid
  type String @db.VarChar(50)
  title String @db.VarChar(250)
  body String
  actionUrl String? @db.VarChar(500)
  isRead Boolean @default(false)
  readAt DateTime? @db.Timestamptz(6)
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // The only query the in-app notification list will ever issue.
  @@index([recipientId, isRead, createdAt])
  @@map("notification")
}

model DevicePushToken {
  id String @id @db.Uuid
  userId String @db.Uuid
  // Unique: the same device registering twice must update its row, not
  // accumulate rows that each earn a duplicate push.
  token String @unique @db.VarChar(500)
  platform String @db.VarChar(20)
  isActive Boolean @default(true)

  @@index([userId, isActive])
  @@map("device_push_token")
}
```

- [ ] **Step 8: Generate the client and the migration**

```bash
DATABASE_URL="postgresql://dummy" pnpm --filter notification exec prisma generate
mkdir -p apps/notification/prisma/migrations/20260921000200_init_notification
printf '# Please do not edit this file manually\nprovider = "postgresql"\n' > apps/notification/prisma/migrations/migration_lock.toml
cd apps/notification && DATABASE_URL="postgresql://dummy" pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/20260921000200_init_notification/migration.sql && cd ../..
```

Expected: the client generates to `apps/notification/node_modules/@prisma-clients/notification`, and the migration file contains `CREATE TABLE "notification"` and `CREATE TABLE "device_push_token"`. Open it and confirm it is not empty.

- [ ] **Step 9: Write the service source**

`apps/notification/src/prisma.service.ts` — identical to the media version with `@prisma-clients/notification` and `NOTIFICATION_DATABASE_URL`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/notification';
import { PrismaBaseService } from '@ipms/persistence';

@Injectable()
export class PrismaService extends PrismaBaseService {
  protected readonly client: PrismaClient;

  constructor() {
    super();
    const connectionString = process.env['NOTIFICATION_DATABASE_URL'];
    if (!connectionString) throw new Error('NOTIFICATION_DATABASE_URL is not set');
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  get db(): PrismaClient {
    return this.client;
  }
}
```

`apps/notification/src/app.module.ts` — the media module with the name changed and the §6.2 note in place of §6.1:

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

/**
 * `notification` has no resource-bearing endpoints yet, so `check()` never
 * consults a scope. An empty, non-global scope is the *least* permissive value
 * available to it, not a stub. Do NOT "fix" this into `global: true`.
 */
const notificationScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

/**
 * DEFERRED — push and email transport (spec 2026-09-20 §6.2).
 *
 * This service will deliver over FCM (Android, with iOS via the APNs bridge)
 * and an SMTP-compatible transactional provider — parent spec §12, assumption 1.
 * Neither client, nor their credentials, nor a `DevicePushToken` registration
 * endpoint exists yet.
 *
 * That is deliberate, and the reason is sharper than tidiness: both are
 * outbound integrations with real-world side effects, and shipping working
 * credentials into a service that cannot yet decide *when* to send is how a
 * test environment mails production users.
 *
 * Add them with the first consumer of a `qc.submission.*` or `project.task.*`
 * event. Transport is meaningless before something decides a notification is
 * due, and becomes urgent the moment something does.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController],
  providers: [
    // Registration order matters: JwtUserGuard must populate request.user
    // before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: notificationScopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
  ],
})
export class AppModule {}
```

`apps/notification/src/main.ts` — the media bootstrap with `'notification'` as the logger name and `3007` as the default port:

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('notification');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  const port = Number(process.env['PORT'] ?? 3007);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'notification service listening');
}

bootstrap().catch((err: unknown) => {
  log.fatal({ err }, 'notification service failed to start');
  process.exit(1);
});
```

- [ ] **Step 10: Write the guard registration test**

Copy `apps/media/src/app.module.spec.ts` to `apps/notification/src/app.module.spec.ts` unchanged — it imports `./app.module.js` relatively and names no service:

```bash
cp apps/media/src/app.module.spec.ts apps/notification/src/app.module.spec.ts
```

Then change the one word in its doc comment that names the service: `` `media` declares directly `` becomes `` `notification` declares directly ``.

- [ ] **Step 11: Run tests, typecheck, lint, build**

```bash
pnpm --filter notification test && pnpm nx run-many -t typecheck lint build -p notification
```

Expected: 4 tests pass; all three targets succeed.

- [ ] **Step 12: Add the database, Compose entries and env var**

Append to `docker/postgres/init.sql`, extending each group:

```sql
CREATE ROLE ipms_notification WITH LOGIN PASSWORD 'ipms_notification';

CREATE DATABASE ipms_notification OWNER ipms_notification;

REVOKE ALL ON DATABASE ipms_notification FROM PUBLIC;

GRANT CONNECT ON DATABASE ipms_notification TO ipms_notification;
```

On an existing volume, apply the same statements directly:

```bash
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ipms_notification WITH LOGIN PASSWORD 'ipms_notification';
CREATE DATABASE ipms_notification OWNER ipms_notification;
REVOKE ALL ON DATABASE ipms_notification FROM PUBLIC;
GRANT CONNECT ON DATABASE ipms_notification TO ipms_notification;
SQL
```

In `docker/docker-compose.yml`, after the `media` service:

```yaml
  notification-migrate:
    <<: *migrate-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      target: migrate
      args: { SERVICE: notification }
    environment:
      DATABASE_URL: postgresql://ipms_notification:ipms_notification@postgres:5432/ipms_notification

  notification:
    <<: *service-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      args: { SERVICE: notification }
    depends_on:
      <<: *infra-ready
      notification-migrate: { condition: service_completed_successfully }
    environment:
      <<: *service-env
      PORT: 3007
      NOTIFICATION_DATABASE_URL: postgresql://ipms_notification:ipms_notification@postgres:5432/ipms_notification
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3007/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

In `.env.example`, after `MEDIA_DATABASE_URL`:

```
NOTIFICATION_DATABASE_URL=postgresql://ipms_notification:ipms_notification@localhost:5432/ipms_notification
```

- [ ] **Step 13: Bring it up and verify**

```bash
docker compose -f docker/docker-compose.yml up -d --build notification gateway
docker compose -f docker/docker-compose.yml ps notification
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/notifications
```

Expected: `notification` shows `healthy`; the curl returns `401`.

- [ ] **Step 14: Commit**

```bash
git add apps/notification apps/gateway/src/proxy/routes.ts apps/gateway/src/proxy/routes.spec.ts docker/postgres/init.sql docker/docker-compose.yml .env.example
git commit -m "feat(notification): scaffold the notification service

Bootable, migrated and routed, carrying Notification and DevicePushToken
from the architecture spec §7.4. No endpoints and no transport yet.

FCM and SMTP are deliberately absent — credentials in a service that
cannot yet decide when to send is how a test environment mails real
users. The module comment names what should add them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `docs` service

The smallest. Same shape, no outbox, no deferral note of its own.

**Files:**
- Modify: `apps/gateway/src/proxy/routes.ts`, `apps/gateway/src/proxy/routes.spec.ts`
- Create: `apps/docs/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `prisma.config.ts`
- Create: `apps/docs/prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20260921000300_init_docs/migration.sql`
- Create: `apps/docs/src/main.ts`, `app.module.ts`, `prisma.service.ts`, `app.module.spec.ts`
- Modify: `docker/postgres/init.sql`, `docker/docker-compose.yml`, `.env.example`
- Modify: `libs/authz/src/permissions.ts`

**Interfaces:**
- Consumes: the same `@ipms/*` exports as Tasks 1 and 2.
- Produces: workspace package `docs` on port 3008, gateway prefix `/api/v1/docs`.

- [ ] **Step 1: Write the failing route tests**

In `apps/gateway/src/proxy/routes.spec.ts`, after the notification tests:

```ts
  it('routes the docs prefix to the docs service', () => {
    const upstream = resolveUpstream('/api/v1/docs/getting-started');
    expect(upstream?.service).toBe('docs');
    expect(upstream?.port).toBe(3008);
  });

  /**
   * "Platform documentation" sounds public. It is not: the documentation
   * describes this system's internals to its operators. If a genuinely public
   * subset is ever wanted it must be an explicit, narrow PUBLIC_PATHS entry
   * argued on its own merits — never a prefix rule, for the reason the comment
   * above PUBLIC_PATHS gives.
   */
  it('keeps the docs prefix authenticated', () => {
    expect(isPublicPath('/api/v1/docs')).toBe(false);
    expect(isPublicPath('/api/v1/docs/getting-started')).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter gateway test
```

Expected: FAIL — `routes the docs prefix to the docs service` gets `undefined`.

- [ ] **Step 3: Add the route**

In `apps/gateway/src/proxy/routes.ts`, after the `NOTIFICATION` constant:

```ts
const DOCS = { host: upstreamHost('docs', 'docs'), port: upstreamPort('docs', 3008) };
```

And in `ROUTES`, after the notifications entry:

```ts
  { prefix: '/api/v1/docs', service: 'docs', ...DOCS },
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter gateway test
```

Expected: PASS.

- [ ] **Step 5: Create the package and configuration**

Derived from the `apps/media` versions the same way Task 2 Step 5 did:

```bash
mkdir -p apps/docs/src apps/docs/prisma
sed 's/"name": "media"/"name": "docs"/' apps/media/package.json > apps/docs/package.json
cp apps/media/tsconfig.json apps/media/tsconfig.build.json apps/media/vitest.config.ts apps/media/prisma.config.ts apps/docs/
```

Verify the name took:

```bash
head -3 apps/docs/package.json
```

Expected: `"name": "docs"`.

- [ ] **Step 6: Install**

```bash
pnpm install
```

Expected: pnpm reports `+ docs`.

- [ ] **Step 7: Write the Prisma schema**

`apps/docs/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  // Each service must generate into its own location — see the note in
  // apps/iam/prisma/schema.prisma for what happens when two services share one.
  output = "../node_modules/@prisma-clients/docs"
}
datasource db {
  provider = "postgresql"
}

model Document {
  id String @id @db.Uuid
  // The addressable identity of a document, not a label.
  slug String @unique @db.VarChar(200)
  title String @db.VarChar(250)
  category String @db.VarChar(100)
  summary String? @db.VarChar(500)
  bodyMd String
  version Int @default(1)
  isPublished Boolean @default(false)
  updatedBy String @db.Uuid
  updatedAt DateTime @updatedAt @db.Timestamptz(6)
  versions DocumentVersion[]

  @@index([category, isPublished])
  @@map("document")
}

model DocumentVersion {
  id String @id @db.Uuid
  documentId String @db.Uuid
  version Int
  bodyMd String
  createdAt DateTime @default(now()) @db.Timestamptz(6)
  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, version])
  @@map("document_version")
}
```

- [ ] **Step 8: Generate the client and the migration**

```bash
DATABASE_URL="postgresql://dummy" pnpm --filter docs exec prisma generate
mkdir -p apps/docs/prisma/migrations/20260921000300_init_docs
printf '# Please do not edit this file manually\nprovider = "postgresql"\n' > apps/docs/prisma/migrations/migration_lock.toml
cd apps/docs && DATABASE_URL="postgresql://dummy" pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/20260921000300_init_docs/migration.sql && cd ../..
```

Expected: the migration file contains `CREATE TABLE "document"`, `CREATE TABLE "document_version"`, and a foreign key from the latter to the former. Open it and confirm it is not empty.

- [ ] **Step 9: Write the service source**

`apps/docs/src/prisma.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/docs';
import { PrismaBaseService } from '@ipms/persistence';

@Injectable()
export class PrismaService extends PrismaBaseService {
  protected readonly client: PrismaClient;

  constructor() {
    super();
    const connectionString = process.env['DOCS_DATABASE_URL'];
    if (!connectionString) throw new Error('DOCS_DATABASE_URL is not set');
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  get db(): PrismaClient {
    return this.client;
  }
}
```

`apps/docs/src/app.module.ts`:

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

/**
 * `docs` has no resource-bearing endpoints yet, so `check()` never consults a
 * scope. An empty, non-global scope is the *least* permissive value available
 * to it, not a stub. Do NOT "fix" this into `global: true`.
 */
const docsScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController],
  providers: [
    // Registration order matters: JwtUserGuard must populate request.user
    // before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: docsScopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
  ],
})
export class AppModule {}
```

`apps/docs/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('docs');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  const port = Number(process.env['PORT'] ?? 3008);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'docs service listening');
}

bootstrap().catch((err: unknown) => {
  log.fatal({ err }, 'docs service failed to start');
  process.exit(1);
});
```

- [ ] **Step 10: Write the guard registration test**

```bash
cp apps/media/src/app.module.spec.ts apps/docs/src/app.module.spec.ts
```

Change the one word in its doc comment that names the service: `` `media` declares directly `` becomes `` `docs` declares directly ``.

- [ ] **Step 11: Record the permission-catalog deferral**

At the end of the `PERMISSIONS` array in `libs/authz/src/permissions.ts`, after the `audit` entries and before the closing `] as const;`:

```ts
  // DEFERRED — no `notification.*` or `docs.*` permissions (spec 2026-09-20 §6.4).
  //
  // `media` needs none added: `qc_evidence.upload` and `qc_evidence.export`
  // above are already its permissions.
  //
  // A permission code is not free. Each one must be seeded, considered for
  // every system role in apps/iam/prisma/seed.ts, and carried in the JWT
  // `permissions` claim of every user who holds it. Codes that guard nothing
  // dilute the catalog the access simulator reports against, and invite roles
  // to be granted authority over behaviour that has not been designed.
  //
  // Define one in the same change as the `@RequirePermission` that uses it and
  // the SYSTEM_ROLES grant that confers it — never before, so that the catalog
  // always describes real authority.
```

This adds no code. `PERMISSIONS.length` is unchanged, so `apps/iam/prisma/seed.integration.spec.ts` still passes.

- [ ] **Step 12: Run tests, typecheck, lint, build**

```bash
pnpm --filter docs test && pnpm nx run-many -t typecheck lint build -p docs authz
```

Expected: 4 docs tests pass; `authz` still passes with the comment added.

- [ ] **Step 13: Add the database, Compose entries and env var**

Append to `docker/postgres/init.sql`, extending each group:

```sql
CREATE ROLE ipms_docs WITH LOGIN PASSWORD 'ipms_docs';

CREATE DATABASE ipms_docs OWNER ipms_docs;

REVOKE ALL ON DATABASE ipms_docs FROM PUBLIC;

GRANT CONNECT ON DATABASE ipms_docs TO ipms_docs;
```

On an existing volume:

```bash
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ipms_docs WITH LOGIN PASSWORD 'ipms_docs';
CREATE DATABASE ipms_docs OWNER ipms_docs;
REVOKE ALL ON DATABASE ipms_docs FROM PUBLIC;
GRANT CONNECT ON DATABASE ipms_docs TO ipms_docs;
SQL
```

In `docker/docker-compose.yml`, after the `notification` service:

```yaml
  docs-migrate:
    <<: *migrate-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      target: migrate
      args: { SERVICE: docs }
    environment:
      DATABASE_URL: postgresql://ipms_docs:ipms_docs@postgres:5432/ipms_docs

  docs:
    <<: *service-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      args: { SERVICE: docs }
    depends_on:
      <<: *infra-ready
      docs-migrate: { condition: service_completed_successfully }
    environment:
      <<: *service-env
      PORT: 3008
      DOCS_DATABASE_URL: postgresql://ipms_docs:ipms_docs@postgres:5432/ipms_docs
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3008/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

In `.env.example`, after `NOTIFICATION_DATABASE_URL`:

```
DOCS_DATABASE_URL=postgresql://ipms_docs:ipms_docs@localhost:5432/ipms_docs
```

- [ ] **Step 14: Bring it up and verify**

```bash
docker compose -f docker/docker-compose.yml up -d --build docs gateway
docker compose -f docker/docker-compose.yml ps docs
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/docs/getting-started
```

Expected: `docs` shows `healthy`; the curl returns `401`.

- [ ] **Step 15: Commit**

```bash
git add apps/docs apps/gateway/src/proxy/routes.ts apps/gateway/src/proxy/routes.spec.ts libs/authz/src/permissions.ts docker/postgres/init.sql docker/docker-compose.yml .env.example
git commit -m "feat(docs): scaffold the docs service

Bootable, migrated and routed, carrying Document and DocumentVersion
from the architecture spec §7.4. No endpoints yet.

Authenticated like every other prefix: the documentation describes this
system's internals to its operators and is not public.

Records why notification.* and docs.* permissions are not in the catalog
yet, at the end of the catalog itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Full-stack verification

Proves the §7 done-when criteria together rather than one service at a time. This is the task that catches a Compose merge-key mistake or a role that was created on a running container but never added to `init.sql`.

**Files:**
- Modify: none, unless a failure is found

**Interfaces:**
- Consumes: all three services from Tasks 1–3.
- Produces: nothing. A verification gate.

- [ ] **Step 1: Rebuild the stack from an empty database**

This is the only way to prove `init.sql` is correct — the edits in Tasks 1–3 never ran if you had an existing volume.

```bash
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d --build
```

**`down -v` destroys the Postgres volume and every local development record with it.** That is the point of this step; if you have local data you want, stop and dump it first.

- [ ] **Step 2: Verify all eight services reach healthy**

```bash
docker compose -f docker/docker-compose.yml ps
```

Expected: `gateway`, `iam`, `audit`, `project`, `qc`, `media`, `notification`, `docs` all `running`, with `healthy` on the five that declare a healthcheck plus the three new ones. All eight `*-migrate` containers show `exited (0)`.

If a migrate container is non-zero:

```bash
docker compose -f docker/docker-compose.yml logs media-migrate notification-migrate docs-migrate --tail 30
```

`role "ipms_x" does not exist` means the `init.sql` edit for that service is missing or misspelled.

- [ ] **Step 3: Verify database isolation holds**

Each role must reach its own database and no other. Confirm the grant, not the convention:

```bash
docker compose -f docker/docker-compose.yml exec -T postgres \
  psql "postgresql://ipms_media:ipms_media@localhost:5432/ipms_qc" -c 'SELECT 1' 2>&1 | head -3
```

Expected: `FATAL: permission denied for database "ipms_qc"`. A `1` here means the `REVOKE`/`GRANT` pair is wrong and cross-service joins are possible — stop and fix `init.sql`.

- [ ] **Step 4: Verify all three prefixes route and are authenticated**

```bash
for p in media notifications docs; do
  printf '%s -> ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/api/v1/$p"
done
```

Expected: `401` for all three. A `404` means the prefix did not resolve at the gateway.

- [ ] **Step 5: Verify internal paths stay private**

```bash
for p in media notifications docs; do
  printf '%s -> ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/api/v1/$p/internal/authz/explain"
done
```

Expected: `404` for all three — refused at the edge before any upstream is chosen.

- [ ] **Step 6: Run the full workspace verification**

```bash
pnpm install --frozen-lockfile && pnpm exec vitest run && pnpm nx run-many -t typecheck lint build
```

Expected: all pass. `--frozen-lockfile` is the check that `pnpm-lock.yaml` was committed with the three new packages — CI runs it and will fail if it was not.

- [ ] **Step 7: Confirm the four deferral comments are in place**

```bash
grep -rn "DEFERRED" apps/media/src/app.module.ts apps/notification/src/app.module.ts libs/authz/src/permissions.ts
```

Expected: **four matches across three files** — §6.1 and §6.3 both in `apps/media/src/app.module.ts`, §6.2 in notification, §6.4 in permissions.

Then confirm `libs/events` really was left alone:

```bash
grep -c "MEDIA_PHOTO" libs/events/src/subjects.ts
```

Expected: `0`. Anything else means a subject was added without its stream, and
`subjects.spec.ts` will already have failed in Step 6.

- [ ] **Step 8: Commit the lockfile if it changed**

```bash
git status --short pnpm-lock.yaml
git add pnpm-lock.yaml && git commit -m "chore: lock the three scaffolded service packages

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If `git status` shows nothing, the lockfile was already committed in an earlier task — skip the commit.

---

## Done when

- All eight services reach healthy from `docker compose down -v && docker compose up -d --build`.
- Each of the three new roles can reach its own database and is refused by every other.
- `/api/v1/media`, `/api/v1/notifications` and `/api/v1/docs` answer `401` through the gateway; their `/internal/` paths answer `404`.
- `pnpm install --frozen-lockfile`, `pnpm exec vitest run`, and `pnpm nx run-many -t typecheck lint build` all pass.
- The four §6 deferrals each carry their comment at the named anchor.
- `docker/Dockerfile.service` and `.github/workflows/ci.yml` are unmodified.
