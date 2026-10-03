-- Field engineers' project access lasts a year and is renewed on request.
--
-- Null means the grant never lapses, which is what every other role keeps.
-- Existing field-engineer grants get a fresh year from today rather than one
-- counted from their creation date, so applying this migration cannot revoke
-- anyone's access on the first sweep.
ALTER TABLE "user_project_scope" ADD COLUMN "expiresAt" timestamptz;
CREATE INDEX "user_project_scope_expiresAt_idx" ON "user_project_scope" ("expiresAt");

UPDATE "user_project_scope" ps
SET "expiresAt" = now() + interval '1 year'
WHERE EXISTS (
  SELECT 1 FROM "user_role" ur
  JOIN "role" r ON r."id" = ur."roleId"
  WHERE ur."userId" = ps."userId" AND r."code" = 'FIELD_ENGINEER'
);
