-- A work order is a task raised against a QC checklist template rather than a
-- project task type, so the task type becomes optional.
ALTER TABLE "task" ALTER COLUMN "taskTypeId" DROP NOT NULL;
ALTER TABLE "task" ADD COLUMN "workOrderType" varchar(30);
ALTER TABLE "task" ADD COLUMN "templateName" varchar(250);
CREATE INDEX "task_projectId_workOrderType_idx" ON "task"("projectId","workOrderType");
