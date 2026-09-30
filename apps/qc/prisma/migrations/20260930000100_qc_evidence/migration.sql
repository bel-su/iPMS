ALTER TABLE "checklist_item"
  ADD COLUMN "minVideos" integer NOT NULL DEFAULT 0,
  ADD COLUMN "maxVideos" integer NOT NULL DEFAULT 0;

-- Every file recorded before videos existed was a photo.
ALTER TABLE "item_photo" RENAME TO "item_media";
ALTER TABLE "item_media" RENAME CONSTRAINT "item_photo_pkey" TO "item_media_pkey";
ALTER TABLE "item_media" RENAME CONSTRAINT "item_photo_itemResponseId_sequence_key" TO "item_media_itemResponseId_sequence_key";
ALTER TABLE "item_media" RENAME CONSTRAINT "item_photo_itemResponseId_fkey" TO "item_media_itemResponseId_fkey";
ALTER TABLE "item_media" ADD COLUMN "kind" varchar(10) NOT NULL DEFAULT 'PHOTO';
ALTER TABLE "item_media" ALTER COLUMN "kind" DROP DEFAULT;

CREATE TABLE "work_order_draft" (
  "workOrderId" uuid PRIMARY KEY REFERENCES "work_order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "holderId" uuid NOT NULL,
  "deviceId" varchar(255) NOT NULL,
  "deviceLabel" varchar(100) NOT NULL,
  "version" integer NOT NULL,
  "responses" jsonb NOT NULL,
  "updatedAt" timestamptz(6) NOT NULL
);
