-- Which expiry warning a grant has already produced: 0 none, 1 the 30-day
-- notice, 2 the 7-day notice. Renewing a grant resets it, so the next year gets
-- its own warnings.
ALTER TABLE "user_project_scope" ADD COLUMN "warnedStage" smallint NOT NULL DEFAULT 0;
