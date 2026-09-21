-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "media_object" (
    "id" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "thumbnailKey" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "uploadedBy" UUID NOT NULL,
    "capturedAt" TIMESTAMPTZ(6),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "watermarkVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" VARCHAR(64) NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_object_storageKey_key" ON "media_object"("storageKey");

-- CreateIndex
CREATE INDEX "media_object_contentHash_idx" ON "media_object"("contentHash");

-- CreateIndex
CREATE INDEX "outbox_event_publishedAt_createdAt_idx" ON "outbox_event"("publishedAt", "createdAt");

