-- The scaffold table never held rows (no endpoint could write one), so it is
-- replaced rather than altered column by column.
DROP TABLE "media_object";

CREATE TABLE "media_object" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalFilename" VARCHAR(255),
    "projectId" UUID,
    "siteId" UUID,
    "siteCode" VARCHAR(50),
    "workOrderId" UUID,
    "checklistItemId" UUID,
    "templateId" UUID,
    "templateVersionId" UUID,
    "storageKey" VARCHAR(500) NOT NULL,
    "thumbnailKey" VARCHAR(500),
    "multipartUploadId" VARCHAR(1024),
    "contentHash" VARCHAR(64) NOT NULL,
    "hashVerified" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMPTZ(6),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "distanceFromSiteM" INTEGER,
    "deviceId" VARCHAR(255),
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "rejectReason" VARCHAR(30),
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6),
    "attachedToSubmissionId" UUID,
    "attachedAt" TIMESTAMPTZ(6),
    "discardAfter" TIMESTAMPTZ(6),
    "discardedAt" TIMESTAMPTZ(6),
    "purgeScheduledAt" TIMESTAMPTZ(6),
    "purgedAt" TIMESTAMPTZ(6),
    "watermarkVerified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "media_object_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_object_storageKey_key" ON "media_object"("storageKey");
CREATE INDEX "media_object_contentHash_idx" ON "media_object"("contentHash");
CREATE INDEX "media_object_status_nextAttemptAt_idx" ON "media_object"("status", "nextAttemptAt");
CREATE INDEX "media_object_workOrderId_idx" ON "media_object"("workOrderId");
CREATE INDEX "media_object_uploadedBy_status_idx" ON "media_object"("uploadedBy", "status");
CREATE INDEX "media_object_projectId_idx" ON "media_object"("projectId");
CREATE INDEX "media_object_discardAfter_idx" ON "media_object"("discardAfter");
