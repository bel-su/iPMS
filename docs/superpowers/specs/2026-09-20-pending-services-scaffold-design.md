# iPMS — Scaffolding `media`, `notification` and `docs` Design

**Status:** Approved
**Date:** 2026-09-20
**Parent spec:** `2026-09-15-ipms-microservices-architecture-design.md` §5, §7.4, §11

---

## 1. Context

The architecture names eight services. Five exist: `gateway`, `iam`, `audit`,
`project`, `qc`. Three do not: `media`, `notification`, `docs`.

Their absence is not evenly felt. `docs` is genuinely independent — sub-project 5, with
nothing waiting on it. `media` and `notification`, by contrast, are load-bearing for the
work that comes next. The whole field-evidence pipeline of §9 — presign, upload, hash,
watermark verification, geofence distance, thumbnail — lives in `media`, and until it
exists there is no endpoint for a field client to send a photo to. Every event in §8
with `notification` as a consumer currently has nowhere to land.

This spec covers standing all three up as bootable, migrated, routed services with no
business endpoints. It deliberately stops short of their domain behaviour.

### 1.1 Why this is worth its own pass

A service in this repository is not one directory. It also touches the Postgres init
script, the Compose stack, the gateway route table and the workspace env template — and
the first two of those fail late rather than loudly. A missing database role surfaces as
a migration container exiting non-zero on `docker compose up`, not as a compile error in
CI. Doing all three at once, mechanically, against a
pattern that five services already demonstrate, is cheaper and far less error-prone than
rediscovering the checklist three separate times inside three feature specs that each
have their own real problems to solve.

### 1.2 Scope

**In:** `apps/media`, `apps/notification`, `apps/docs` — package and TypeScript config,
Prisma schema and initial migration, Nest bootstrap, guard wiring, health and metrics,
database roles, Compose entries, gateway routes.

**Out:** every business endpoint, and therefore every contract schema. Object storage,
FCM and SMTP clients. Event subjects and their JetStream streams. New permission entries.
`docs-web` and `mobile`, which are clients rather than services and are covered by their
own specs. See §6 for each omission and the condition that ends it.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | Scaffold carries the full §7.4 schema, not an empty one | The models are already specified and settled; writing them now is transcription, not design |
| S2 | No business endpoints, and therefore no `@ipms/contracts` entries | A contract with no implementation is a claim the service does not honour |
| S3 | Gateway routes registered now | One line each, and it is what makes reachability provable end to end |
| S4 | Ports 3006, 3007, 3008 | A clean contiguous block; 3002 is unallocated for reasons nobody records, and filling it would invent one |
| S5 | `media` carries the outbox table; the other two do not | `media` is the only one of the three that publishes |
| S6 | Each service is born with `app.module.spec.ts` | A real bug shipped where `@RequirePermission` decorators had no guard behind them |

---

## 3. What a service is here

Established by `audit`, `project` and `qc`, and followed exactly. Per service:

```
apps/<svc>/
├── package.json            name, type: module, build/test/typecheck/prisma:generate
├── tsconfig.json           extends base; paths: {} — libraries consumed as packages
├── tsconfig.build.json     emit-only, excludes specs
├── vitest.config.ts        node environment, Testcontainers setup file
├── prisma.config.ts        schema + migrations path, DATABASE_URL
├── prisma/
│   ├── schema.prisma       generator output → node_modules/@prisma-clients/<svc>
│   └── migrations/<ts>_init_<svc>/migration.sql
└── src/
    ├── main.ts             Fastify, shutdown hooks, api/v1 prefix, health excluded
    ├── app.module.ts       ConfigModule, two APP_GUARDs, scope/override providers,
    │                       PrismaService + postgres readiness check
    ├── prisma.service.ts   extends PrismaBaseService over <SVC>_DATABASE_URL
    └── app.module.spec.ts  guard registration, copied from audit
```

Plus, outside the service directory:

| File | Change |
|---|---|
| `docker/postgres/init.sql` | role, database, `REVOKE ALL`, `GRANT CONNECT` — three lines each, in the existing groupings |
| `docker/docker-compose.yml` | `<svc>-migrate` one-shot and `<svc>` with healthcheck, following the `qc` pair verbatim |
| `apps/gateway/src/proxy/routes.ts` | host/port constant and one `ROUTES` entry |
| `.env.example` | `<SVC>_DATABASE_URL` for running outside Compose |
| `libs/authz/src/permissions.ts` | the §6.4 note only — no new codes |

`libs/events` is deliberately **not** touched — see §6.3.

`docker/Dockerfile.service` and `.github/workflows/ci.yml` need **no change at all**. The
Dockerfile is generic over its `SERVICE` build argument and already branches on whether
a `prisma/schema.prisma` exists; CI runs `nx affected`, which discovers new projects from
the workspace. This is the payoff from how those two were written, and it is worth
stating so nobody goes looking for the edit.

### 3.1 Guard wiring

Every service registers `JwtUserGuard` before `AuthzGuard`, in that order, and provides
both `SCOPE_PROVIDER` and `OVERRIDE_PROVIDER`. All three new services take the same
values `audit` and `qc` use today: an empty non-global scope, and `emptyOverrideProvider`.

For a service with no resource-bearing endpoints this is not a stub, it is the least
permissive value available. The comment in `apps/audit/src/app.module.ts` explaining why
an empty scope must not later be "fixed" into `global: true` applies here unchanged and
is carried across.

---

## 4. The three services

| | `media` | `notification` | `docs` |
|---|---|---|---|
| Port | 3006 | 3007 | 3008 |
| Database | `ipms_media` | `ipms_notification` | `ipms_docs` |
| Role | `ipms_media` | `ipms_notification` | `ipms_docs` |
| Env var | `MEDIA_DATABASE_URL` | `NOTIFICATION_DATABASE_URL` | `DOCS_DATABASE_URL` |
| Gateway prefix | `/api/v1/media` | `/api/v1/notifications` | `/api/v1/docs` |
| Outbox | yes | no | no |

### 4.1 Schemas

Transcribed from §7.4, with the column conventions the existing schemas use — `@db.Uuid`
for identifiers, `@db.Timestamptz(6)` for instants, bounded `@db.VarChar` for enum-like
strings held as text.

**`media`** — one model plus the outbox:

```
MediaObject   id · storageKey · contentType · sizeBytes
              contentHash · thumbnailKey · status
              uploadedBy · capturedAt · latitude · longitude
              watermarkVerified · createdAt
OutboxEvent   verbatim from OUTBOX_MODEL_SQL in @ipms/persistence
```

`contentHash` is indexed. It is how a duplicate upload is recognised, and adding the
index with the table costs nothing while adding it later costs a migration on a table
that by then holds every photo in the system.

**`notification`** — two models, no outbox:

```
Notification     id · recipientId · type · title · body · actionUrl
                 isRead · readAt · createdAt
DevicePushToken  id · userId · token · platform · isActive
```

`Notification` is indexed on `(recipientId, isRead, createdAt)`, which is the only query
the in-app notification list will ever issue. `DevicePushToken.token` is unique — the
same device registering twice must update its row, not accumulate rows that each earn a
duplicate push.

**`docs`** — two models, no outbox:

```
Document         id · slug · title · category · summary · bodyMd
                 version · isPublished · updatedBy · updatedAt
DocumentVersion  id · documentId · version · bodyMd · createdAt
```

`Document.slug` is unique — it is the addressable identity of a document, not a label.
`DocumentVersion` is unique on `(documentId, version)`.

### 4.2 Gateway routes

Three entries appended to `ROUTES`, each with its `upstreamHost`/`upstreamPort` pair in
the style of the existing constants. None is added to `PUBLIC_PATHS`.

`docs` is worth a note, because "platform documentation" sounds public. It is not: the
documentation describes this system's internals to its operators, and the gateway's
authenticated-by-default posture is the right one. If a genuinely public subset is ever
wanted it should be an explicit, narrow `PUBLIC_PATHS` entry argued on its own merits,
never a prefix rule — the comment above `PUBLIC_PATHS` already explains why prefix rules
there are dangerous.

---

## 5. Tests

The scaffold is mostly configuration, and configuration is verified by the thing booting
rather than by unit tests. Three checks, no more:

| Where | What |
|---|---|
| `apps/<svc>/src/app.module.spec.ts` | Exactly two `APP_GUARD` providers, `JwtUserGuard` before `AuthzGuard`, `SCOPE_PROVIDER` present. Reads `@Module()` metadata, so it needs no Postgres, NATS or Redis |
| `apps/gateway/src/proxy/routes.spec.ts` | The three new prefixes resolve to the right service; `/internal/` under them is still refused; none is public |
| Compose | All eight services reach healthy from a cold `docker compose up` |

Nothing else is worth testing yet, because nothing else does anything yet. Integration
tests arrive with the behaviour they would cover.

---

## 6. Deferred work, and what should bring it back

Each omission below is recorded twice: here, and as a comment at the exact place in the
code where it will be picked up. The second is what actually works — the pattern the
`OVERRIDE_PROVIDER` comment in `apps/audit/src/app.module.ts` sets, where the note sits
in the file whose author will need it, says why the current value is safe rather than
merely temporary, and names the change that ends the arrangement.

### 6.1 Object storage for `media`

**Deferred:** no S3/R2 client, no `S3_ENDPOINT`, `S3_BUCKET` or credential configuration,
and readiness reports only Postgres.

**Why:** declared configuration that nothing reads is configuration that lies. An
operator who sets `S3_BUCKET` on this scaffold would reasonably conclude uploads are
wired, and would be wrong.

**Bring it back when:** the first presigned-upload endpoint is specified — the opening
move of the media feature spec. At that point `S3_*` configuration, the client, and a
storage readiness check all land together, because a `media` service that reports ready
while its bucket is unreachable will accept presign requests it cannot honour.

**Anchor:** beside `registerReadinessCheck('postgres', …)` in
`apps/media/src/app.module.ts`.

### 6.2 FCM and SMTP for `notification`

**Deferred:** no push or email transport, no credentials, no `DevicePushToken`
registration endpoint.

**Why:** the same reason as §6.1, plus a sharper one — both are outbound integrations
with real-world side effects, and shipping credentials into a service that cannot yet
decide when to send is how a test environment mails production users.

**Bring it back when:** the first consumer of a `qc.submission.*` or `project.task.*`
event is written. Transport is meaningless before something decides a notification is
due; it becomes urgent the moment something does. Per assumption 1 in §12 of the parent
spec, this is FCM for Android with iOS via the APNs bridge, and an SMTP-compatible
transactional provider for email.

**Anchor:** beside the provider list in `apps/notification/src/app.module.ts`.

### 6.3 Media subjects and their JetStream stream

**Deferred:** `libs/events` is not touched at all. No `SUBJECTS` entries, no `STREAMS`
entry.

**Why:** an earlier draft of this spec proposed adding the two subject constants now and
the stream later, on the grounds that constants are inert and a durable consumer with no
reader is a queue filling silently behind code that does not exist.

The codebase already refuses that split, and for a better reason. `subjects.spec.ts`
asserts that every entry in `SUBJECTS` is covered by exactly one stream:

```ts
it('covers every subject with exactly one stream', () => { … })
```

That invariant is the mechanical form of the hazard the earlier draft could only
describe in a comment: **a subject with no stream is a message that vanishes.** Adding
the constants alone would fail the suite, and the correct response is to respect the
invariant rather than weaken the test.

So both halves move together, which is what should have been specified in the first
place. Naming a subject is not free vocabulary — under this invariant it is a commitment
that somewhere to deliver it exists.

**Bring it back when:** the first producer or consumer of a media event is written. The
subjects, the `MEDIA` stream and its durable consumers all land in that one change, and
`STREAMS` — typed `Record<'IAM' | 'AUDIT', StreamDefinition>` — widens its key union
then.

**Anchor:** none in `libs/events`, since nothing there changes. The reminder lives with
the storage note in `apps/media/src/app.module.ts`, which is the file that will be open
when media events are first published.

### 6.4 Permission catalog entries

**Deferred:** no `notification.*` or `docs.*` permissions. `media` needs none added —
`qc_evidence.upload` and `qc_evidence.export` already exist and are its permissions.

**Why:** a permission code is not free. Each one must be seeded, considered for every
one of the five system roles, and carried in the JWT `permissions` claim of every user
who holds it. Codes that guard nothing dilute the catalog the access simulator reports
against, and invite roles to be granted authority over behaviour that has not been
designed.

**Bring it back when:** an endpoint needs guarding. The permission is defined in the same
change as the `@RequirePermission` that uses it and the `SYSTEM_ROLES` grants in
`apps/iam/prisma/seed.ts` — never before, so that the catalog always describes real
authority.

**Anchor:** the end of the `PERMISSIONS` array in `libs/authz/src/permissions.ts`, after
the audit block.

---

## 7. Done when

- `docker compose up` brings all eight services to healthy from cold, each connecting as
  its own role to its own database and able to reach no other.
- A request to `/api/v1/media`, `/api/v1/notifications` or `/api/v1/docs` with a valid
  token is answered by the corresponding service — a 404 from the service rather than
  from the edge, which is what proves the route resolves and the token is verified.
- The same three prefixes under `/internal/` are still refused at the gateway.
- `pnpm nx run-many -t typecheck lint test build` passes.
- Each of the four deferrals in §6 has its comment in place at the named anchor.

---

## 8. What this does not change

`Dockerfile.service`, the CI workflow, and all five existing services are untouched. The
only edits outside the three new directories are additive: three rows in `init.sql`, two
Compose entries each, three `ROUTES` entries, one comment in `libs/authz`, and three
lines in `.env.example`. `libs/events` is untouched. No existing behaviour can observe
any of it.
