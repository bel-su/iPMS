ALTER TABLE "project" ADD COLUMN "defaultGeofenceRadiusM" integer DEFAULT 500;
ALTER TABLE "site" ADD COLUMN "geofenceMode" varchar(10) NOT NULL DEFAULT 'INHERIT';
UPDATE "site" SET "geofenceMode" = 'CUSTOM';
ALTER TABLE "site" ALTER COLUMN "geofenceRadiusM" DROP NOT NULL;
ALTER TABLE "site" ALTER COLUMN "geofenceRadiusM" DROP DEFAULT;
