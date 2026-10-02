-- AlterTable
ALTER TABLE "notification" ADD COLUMN "eventId" UUID,
ADD COLUMN "workOrderId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipientId_eventId_key" ON "notification"("recipientId", "eventId");
