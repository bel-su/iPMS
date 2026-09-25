-- Work order lifecycle: status sync from qc, cancellation, and a timeline.
ALTER TABLE "task" ADD COLUMN "currentAttemptNo" integer;
ALTER TABLE "task" ADD COLUMN "cancelReason" varchar(500);
ALTER TABLE "task" ADD COLUMN "createdAt" timestamptz(6) NOT NULL DEFAULT now();
CREATE INDEX "task_plannedCompletionAt_idx" ON "task"("plannedCompletionAt");

CREATE TABLE "work_order_event" (
  "id" uuid PRIMARY KEY,
  "taskId" uuid NOT NULL REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" varchar(20) NOT NULL,
  "at" timestamptz(6) NOT NULL,
  "actorId" uuid,
  "detail" jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX "work_order_event_taskId_at_idx" ON "work_order_event"("taskId","at");
