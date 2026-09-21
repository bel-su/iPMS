ALTER TABLE "submission" ADD COLUMN "latitude" decimal(10,7);
ALTER TABLE "submission" ADD COLUMN "longitude" decimal(10,7);
ALTER TABLE "submission" ADD COLUMN "distanceFromSiteM" integer;
ALTER TABLE "submission" ADD COLUMN "geofenceStatus" varchar(20) NOT NULL DEFAULT 'NOT_APPLICABLE';
