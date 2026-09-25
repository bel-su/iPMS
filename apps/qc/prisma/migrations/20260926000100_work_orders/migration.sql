-- Work orders move from project to qc. Ids are kept, so submissions already
-- recorded against a task id stay attached to the same work order; the rows
-- themselves are copied by prisma/import-project-work-orders.ts.
CREATE TABLE "work_order" (
  "id" uuid PRIMARY KEY,
  "projectId" uuid NOT NULL,
  "projectCode" varchar(50) NOT NULL,
  "projectName" varchar(200) NOT NULL,
  "siteId" uuid NOT NULL,
  "siteCode" varchar(50) NOT NULL,
  "siteName" varchar(200) NOT NULL,
  "siteCity" varchar(100),
  "siteArea" varchar(100),
  "templateId" uuid NOT NULL REFERENCES "checklist_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "templateName" varchar(250) NOT NULL,
  "workOrderType" varchar(30) NOT NULL,
  "title" varchar(250) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'NOT_STARTED',
  "assigneeId" uuid NOT NULL,
  "plannedCompletionAt" timestamptz(6) NOT NULL,
  "actualCompletionAt" timestamptz(6),
  "currentSubmissionId" uuid,
  "currentAttemptNo" integer,
  "cancelReason" varchar(500),
  "createdBy" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX "work_order_projectId_status_idx" ON "work_order"("projectId","status");
CREATE INDEX "work_order_siteId_idx" ON "work_order"("siteId");
CREATE INDEX "work_order_assigneeId_idx" ON "work_order"("assigneeId");
CREATE INDEX "work_order_plannedCompletionAt_idx" ON "work_order"("plannedCompletionAt");

CREATE TABLE "work_order_event" (
  "id" uuid PRIMARY KEY,
  "workOrderId" uuid NOT NULL REFERENCES "work_order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" varchar(20) NOT NULL,
  "at" timestamptz(6) NOT NULL,
  "actorId" uuid,
  "detail" jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX "work_order_event_workOrderId_at_idx" ON "work_order_event"("workOrderId","at");
