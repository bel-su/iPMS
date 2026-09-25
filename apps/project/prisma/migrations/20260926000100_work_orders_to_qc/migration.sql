-- Work orders move to qc. qc's migrate step copies them, ids and timelines
-- included (apps/qc/prisma/import-project-work-orders.ts), and Compose runs
-- this migration only after that step has completed. Run by hand, run the
-- import first: this deletes the only other copy.
DROP TABLE "work_order_event";
DELETE FROM "task" WHERE "workOrderType" IS NOT NULL OR "taskTypeId" IS NULL;
DROP INDEX IF EXISTS "task_projectId_workOrderType_idx";
ALTER TABLE "task" DROP COLUMN "workOrderType";
ALTER TABLE "task" DROP COLUMN "templateName";
ALTER TABLE "task" DROP COLUMN "currentAttemptNo";
ALTER TABLE "task" DROP COLUMN "cancelReason";
ALTER TABLE "task" DROP COLUMN "currentSubmissionId";
ALTER TABLE "task" ALTER COLUMN "taskTypeId" SET NOT NULL;
