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
