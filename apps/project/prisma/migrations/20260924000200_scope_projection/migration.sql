-- The local projection of iam's scope grants, and the watermark that tells a
-- lost projection apart from an empty one.

CREATE TABLE "user_scope" (
  "id" uuid PRIMARY KEY,
  "userId" uuid NOT NULL,
  "level" varchar(10) NOT NULL,
  "projectId" uuid,
  "siteId" uuid,
  "grantedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_scope_level_check" CHECK ("level" IN ('GLOBAL','PROJECT','SITE')),
  -- A PROJECT grant without a project, or a SITE grant without a site, is a
  -- replication bug that would otherwise sit in the table quietly widening or
  -- narrowing someone's access.
  CONSTRAINT "user_scope_shape_check" CHECK (
    ("level" = 'GLOBAL'  AND "projectId" IS NULL AND "siteId" IS NULL)
    OR ("level" = 'PROJECT' AND "projectId" IS NOT NULL AND "siteId" IS NULL)
    OR ("level" = 'SITE'    AND "siteId" IS NOT NULL)
  )
);
CREATE INDEX "user_scope_userId_idx" ON "user_scope"("userId");

-- Three partial unique indexes, not one composite unique. PostgreSQL treats
-- NULL as never equal to NULL in a unique index, so a composite over these
-- nullable columns would only ever reject duplicates of the fully site-scoped
-- shape and would silently accept unlimited duplicate global and project
-- grants. A duplicate row survives one revocation and keeps access alive after
-- it was withdrawn. Same hazard iam's user_role hit.
CREATE UNIQUE INDEX "user_scope_global_uniq"  ON "user_scope"("userId")             WHERE "level" = 'GLOBAL';
CREATE UNIQUE INDEX "user_scope_project_uniq" ON "user_scope"("userId","projectId") WHERE "level" = 'PROJECT';
CREATE UNIQUE INDEX "user_scope_site_uniq"    ON "user_scope"("userId","siteId")    WHERE "level" = 'SITE';

CREATE TABLE "projection_watermark" (
  "name" varchar(50) PRIMARY KEY,
  "updatedAt" timestamptz NOT NULL
);
