# Project: iPMS Production Audit, Planning, and Bug Remediation

## Architecture
iPMS (Infrastructure Project Management System) is an enterprise monorepo comprising:
- **Mobile Client**: Flutter application (`apps/mobile`) for offline-first field inspections, evidence capture, watermarking, and task completion.
- **Web Client**: Next.js 16 App Router application (`apps/web`) for project management, QC reviews, finance workflows, and administration.
- **API Gateway**: Fastify-based NestJS proxy (`apps/gateway`) routing requests, terminating sessions, and handling CORS/rate-limiting.
- **Backend Microservices**: Fastify/Prisma/PostgreSQL services:
  - `apps/iam`: Identity & access management, RBAC, authentication.
  - `apps/project`: Projects, sites, milestones, and site assignments.
  - `apps/qc`: Inspection templates, work orders, submissions, self-checks.
  - `apps/finance`: Advances, settlements, invoices, financial approvals.
  - `apps/media`: File uploads, presigned URLs, MinIO/S3 storage integration.
  - `apps/notification`: Event-driven in-app and push notifications via NATS.
  - `apps/audit`: Cryptographically verifiable SHA-256 hash-chain audit log.
  - `apps/docs`: Document versioning microservice.
- **Shared Libraries**: `@ipms/contracts` (Zod schemas), `@ipms/authz` (RBAC & scoping), `@ipms/events` (NATS event bus), `@ipms/geo`, `@ipms/observability`, `@ipms/persistence`.

## Feature Inventory
| # | Feature / Issue | Description | Milestone | Source |
|---|----------------|-------------|-----------|--------|
| 1 | Inter-Service Bearer Token Forwarding | Controllers forward empty token for cookie-auth sessions, causing downstream 401 | M1 | Backend Audit |
| 2 | Audit Hash Chain Range Verification Bug | Hardcoded GENESIS_HASH causes false-positive corruption in range queries | M1 | Backend Audit |
| 3 | Authorization In-Memory Scope Inconsistency | Sequential project AND site evaluation in evaluate.ts rejects site-scoped users | M1 | Backend Audit |
| 4 | Gateway CORS Missing PUT Method | Preflight fails for PUT proxy routes (e.g. user role updates) | M1 | Backend Audit |
| 5 | IAM Self-Service Profile Schema Ghost Fields | UpdateSelfProfileSchema accepts unbacked fields and allows employeeCode self-edit | M1 | Backend Audit |
| 6 | Observability Unit Test Fastify Socket Bindings | Ephemeral socket EACCES with supertest on Fastify | M1 | Backend Audit |
| 7 | QC Review Console Stale State Race | Hidden input reads stale React state, approving rejected work orders on click | M2 | Web Audit |
| 8 | Logout Route Open Redirect | Unvalidated X-Forwarded-Host header causes open redirect to arbitrary origin | M2 | Web Audit |
| 9 | Content Security Policy Media & Storage Block | CSP blocks 302 redirects to MinIO/S3 images and omits media-src | M2 | Web Audit |
| 10 | Photo Package Heap Memory Exhaustion / OOM | 250MB buffer in JSZip spikes memory >500MB, crashing web container | M2 | Web Audit |
| 11 | Missing Next.js Error Boundaries | Lack of error.tsx and global-error.tsx crashes app shell on uncaught errors | M2 | Web Audit |
| 12 | Web Search Scope & Proxy Download Duplication | Search from /finance routes to work-orders; duplicated proxyDownload in site import | M2 | Web Audit |
| 13 | Mobile AuthInterceptor Header Overwrite | Interceptor overwrites caller-supplied Authorization header with stored token | M3 | Mobile Audit |
| 14 | Android Manifest Cleartext Traffic Enabled | android:usesCleartextTraffic="true" enabled in production release manifest | M3 | Mobile Audit |
| 15 | Watermark Service Slash Filename Crash | Site codes with slashes (e.g. KOS/101) throw FileSystemException on save | M3 | Mobile Audit |
| 16 | QC Checklist Submission Contract Deprecation | Mobile sends deprecated photoMediaIds; needs canonical mediaIds | M3 | Mobile Audit |
| 17 | Mobile Pubspec Cleanliness | Remove unused cupertino_icons dependency from pubspec.yaml | M3 | Mobile Audit |
| 18 | Docker Compose Selective Staging Profiles | Decouple gateway depends_on and configure profiles for API+Mobile and API+Web | M4 | Infra Audit |
| 19 | Full Workspace Regression Test Verification | Verify all unit & contract tests across mobile, web, and backend pass without regressions | M4 | Infra Audit |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Backend & Shared Core Remediation | Fix inter-service auth forwarding, audit hash range bug, authz scope engine, gateway CORS, IAM user schema, observability test bindings | none | COMPLETED |
| 2 | Web Application Remediation | Fix QC review console state bug, logout open redirect, CSP media/storage, photo package OOM, error boundaries, search scope | M1 | COMPLETED |
| 3 | Mobile Application Remediation | Fix AuthInterceptor token overwrite, Android cleartext disable, watermark slash sanitization, checklist contract update, pubspec cleanup | M1 | COMPLETED |
| 4 | Docker Selective Staging & Final Verification | Docker compose staging profiles (api+mobile, api+web), run full workspace test suites, verify zero regressions | M1, M2, M3 | COMPLETED |

## Interface Contracts
### Web / Mobile ↔ API Gateway
- Base URL: `http://localhost:3000` (or `http://gateway:3000`)
- Auth:
  - Mobile: Bearer token in `Authorization: Bearer <token>`
  - Web: HTTP-only secure cookie `ipms_access=<token>`
- Token extraction: Gateway / services must use `extractToken(req)` to accept either cookie or header.

### Inter-Service Gateway / Controller Calls
- Header: `Authorization: Bearer <token>`
- Microservice endpoints forward valid bearer token from calling context to downstream dependencies.

### QC Checklist Item Contract
- Field: `mediaIds: string[]` (Zod schema in `@ipms/contracts/qc/qc.ts`). Mobile sends `mediaIds` alongside backwards-compatible `photoMediaIds`.

## Code Layout
- `apps/mobile`: Flutter mobile application (Dart).
- `apps/web`: Next.js 16 Web application (TypeScript/React).
- `apps/gateway`: NestJS Fastify API Gateway.
- `apps/{iam,project,qc,finance,media,notification,audit,docs}`: NestJS backend microservices.
- `libs/{contracts,authz,events,geo,observability,persistence}`: Shared TypeScript packages.
- `docker/docker-compose.yml`: Multi-service staging and infrastructure orchestration.
