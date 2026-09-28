# Environment Files per Service

This directory contains individual environment files for each microservice and its dedicated database:

| Service / Database | Environment File | Default Port | Description |
| :--- | :--- | :--- | :--- |
| **IAM Database** | `iam-db.env` | 5433 (mapped to 5432) | PostgreSQL credentials for IAM database (`ipms_iam`) |
| **IAM Service** | `iam.env` | 3001 | Identity and Access Management service + migrations |
| **Audit Database** | `audit-db.env` | 5434 (mapped to 5432) | PostgreSQL credentials for Audit database (`ipms_audit`) |
| **Audit Service** | `audit.env` | 3003 | Tamper-evident Audit logging service + migrations |
| **Project Database** | `project-db.env` | 5435 (mapped to 5432) | PostgreSQL credentials for Project database (`ipms_project`) |
| **Project Service** | `project.env` | 3004 | Projects, sites, and tasks management service + migrations |
| **QC Database** | `qc-db.env` | 5436 (mapped to 5432) | PostgreSQL credentials for Quality Control database (`ipms_qc`) |
| **QC Service** | `qc.env` | 3005 | Quality Control inspections and checklists service + migrations |
| **Media Database** | `media-db.env` | 5437 (mapped to 5432) | PostgreSQL credentials for Media database (`ipms_media`) |
| **Media Service** | `media.env` | 3006 | Media (evidence uploads) service + migrations |
| **Notification Database** | `notification-db.env` | 5438 (mapped to 5432) | PostgreSQL credentials for Notification database (`ipms_notification`) |
| **Notification Service** | `notification.env` | 3007 | Notification service + migrations |
| **Docs Database** | `docs-db.env` | 5439 (mapped to 5432) | PostgreSQL credentials for Docs database (`ipms_docs`) |
| **Docs Service** | `docs.env` | 3008 | Documents service + migrations |
| **API Gateway** | `gateway.env` | 3000 | Reverse proxy, authentication verification, rate limiter |
| **Web Frontend** | `web.env` | 3100 | Next.js portfolio dashboard web application |

## Media object storage

`media.env` points at the local MinIO container. On staging and production,
create **`media.secrets.env`** next to it (gitignored — never commit it) with
that environment's Cloudflare R2 values; Compose loads it after `media.env`,
so its values win:

    S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
    S3_PUBLIC_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
    S3_REGION=auto
    S3_BUCKET=ipms-media-prod            # or ipms-media-staging
    S3_ACCESS_KEY_ID=...
    S3_SECRET_ACCESS_KEY=...
    S3_FORCE_PATH_STYLE=false
    S3_AUTO_CREATE_BUCKET=false

All eight `S3_*` values above are required in `media.secrets.env` on every
server — media fails to start if any of them is missing (config.ts reads them
once at bootstrap, on purpose, rather than failing on the first upload).

### Deployment checklist (per environment)

1. R2 bucket exists with `r2.dev` public access disabled and no custom domain.
2. An Account API token scoped to **that bucket only**, *Object Read & Write*, **no client IP filter**.
3. Lifecycle rule: abort incomplete multipart uploads after 7 days. No object-expiry rules.
4. `media.secrets.env` created on the server with the values above.
5. When the environment has a web domain: CORS policy allowing `GET`, `PUT`, `HEAD` from that origin only, headers `content-type` and `x-amz-checksum-sha256`, exposing `ETag`.
6. Smoke test: register, upload and complete one photo against the bucket, confirm it turns `READY`, open its view link, then delete it. Also confirm the multipart (video) path against the same bucket: register an 11 MiB mp4, upload part 1, check `POST /media/uploads/status`, fetch fresh URLs for the remaining parts (`POST /media/uploads/:id/parts`), finish uploading, call `complete`, and confirm the object turns `READY`. This exercises R2's actual multipart behaviour and error names (`NoSuchUpload`, `InvalidPart`, …), which MinIO does not always reproduce exactly.
