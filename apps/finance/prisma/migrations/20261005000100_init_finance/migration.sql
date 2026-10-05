-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "expense_category" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "disabledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_request" (
    "id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "entryStatus" VARCHAR(30),
    "projectId" UUID NOT NULL,
    "projectCode" VARCHAR(50) NOT NULL,
    "projectName" VARCHAR(200) NOT NULL,
    "workOrderId" UUID,
    "categoryId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "advanceId" UUID,
    "purpose" VARCHAR(500) NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "approvedAmount" DECIMAL(14,2),
    "appliedAmount" DECIMAL(14,2),
    "submittedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_invoice" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "vendor" VARCHAR(200) NOT NULL,
    "invoiceNumber" VARCHAR(100) NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mediaId" UUID NOT NULL,

    CONSTRAINT "request_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_action" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "step" VARCHAR(20) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "actorId" UUID NOT NULL,
    "amount" DECIMAL(14,2),
    "comment" VARCHAR(1000),
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "paidOn" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" VARCHAR(500),
    "proofMediaId" UUID,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_counter" (
    "key" VARCHAR(20) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "number_counter_pkey" PRIMARY KEY ("key")
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
CREATE UNIQUE INDEX "expense_category_code_key" ON "expense_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "finance_request_number_key" ON "finance_request"("number");

-- CreateIndex
CREATE INDEX "finance_request_projectId_status_idx" ON "finance_request"("projectId", "status");

-- CreateIndex
CREATE INDEX "finance_request_requesterId_status_idx" ON "finance_request"("requesterId", "status");

-- CreateIndex
CREATE INDEX "finance_request_advanceId_idx" ON "finance_request"("advanceId");

-- CreateIndex
CREATE INDEX "finance_request_status_idx" ON "finance_request"("status");

-- CreateIndex
CREATE INDEX "request_invoice_requestId_idx" ON "request_invoice"("requestId");

-- CreateIndex
CREATE INDEX "approval_action_requestId_at_idx" ON "approval_action"("requestId", "at");

-- CreateIndex
CREATE INDEX "payment_requestId_kind_idx" ON "payment"("requestId", "kind");

-- CreateIndex
CREATE INDEX "outbox_event_publishedAt_createdAt_idx" ON "outbox_event"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "finance_request" ADD CONSTRAINT "finance_request_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_request" ADD CONSTRAINT "finance_request_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "finance_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_invoice" ADD CONSTRAINT "request_invoice_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "finance_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_action" ADD CONSTRAINT "approval_action_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "finance_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "finance_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Starting categories. Finance maintains the list from here on.
INSERT INTO "expense_category" ("id", "code", "name") VALUES
  ('01930000-0000-7000-8000-000000000001', 'TRAVEL', 'Travel'),
  ('01930000-0000-7000-8000-000000000002', 'MATERIALS', 'Materials'),
  ('01930000-0000-7000-8000-000000000003', 'LABOUR', 'Labour'),
  ('01930000-0000-7000-8000-000000000004', 'ACCOMMODATION', 'Accommodation'),
  ('01930000-0000-7000-8000-000000000005', 'FUEL', 'Fuel'),
  ('01930000-0000-7000-8000-000000000006', 'MISC', 'Miscellaneous');
