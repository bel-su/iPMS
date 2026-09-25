-- Work order names carry the site ID, not the site name: `[Quality Self-check]KOS001`.
-- Renames work orders raised under the old rule, keeping the type label and any
-- note after the name. The same statement runs after the project import
-- (prisma/import-project-work-orders.ts), for rows copied in later.
UPDATE "work_order"
   SET "title" = left(substr("title", 1, position(']' IN "title")) || "siteCode" || substr("title", position(']' IN "title") + 1 + length("siteName")), 250)
 WHERE "siteName" <> "siteCode"
   AND position(']' IN "title") > 0
   AND substr("title", position(']' IN "title") + 1, length("siteName")) = "siteName";
