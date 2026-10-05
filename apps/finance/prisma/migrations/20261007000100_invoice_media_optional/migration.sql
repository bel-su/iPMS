-- Invoice files are optional until finance documents can be uploaded through the media service.
ALTER TABLE "request_invoice" ALTER COLUMN "mediaId" DROP NOT NULL;
