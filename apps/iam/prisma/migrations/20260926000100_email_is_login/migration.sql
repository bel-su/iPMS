-- Email becomes the one login identifier; the separate username goes.
--
-- Emails are lowercased first because the application now stores and looks
-- them up lowercased. If two existing accounts differ only by case, the
-- unique index makes this migration fail rather than silently merge them.
UPDATE "user" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));

DROP INDEX "user_username_key";
ALTER TABLE "user" DROP COLUMN "username";
